// Plays utterance requests through a platform speech engine, keeping the coach short,
// current and interruptible. Engine-agnostic: the web build passes a SpeechSynthesis
// adapter (src/platform/speech/webSpeechEngine.js); a native app passes a native TTS one.
//
// Engine interface:
//   isAvailable(): boolean
//   speak(text, {rate, volume, pitch, lang, voiceId}, {onStart, onEnd, onError}): void
//   cancel(): void
//
// Queue policy
//   * At most ONE utterance waits behind the one being spoken; a newer request of equal or
//     higher priority replaces it, so a backlog of old instructions can never build up.
//   * A queued utterance is re-checked (isValid() and maxAgeMs) right before it would play.
//   * A request with interrupt=true, or a clearly higher priority, cuts the current one off.
//   * Muted: nothing is spoken, but every request still reaches onCaption (visual feedback).

export const DEFAULT_VOICE_SETTINGS = Object.freeze({
  enabled: true,
  rate: 1.0,
  volume: 1.0,
  pitch: 1.0,
  lang: "en-US",
  voiceId: null,
});

const INTERRUPT_MARGIN = 15; // priority difference needed to cut off the current utterance

export class VoiceCoach {
  /**
   * @param {object|null} engine
   * @param {object} [settings]
   * @param {{now?: () => number, onCaption?: Function, onSpeakStart?: Function, maxQueueAgeMs?: number}} [hooks]
   */
  constructor(engine, settings = {}, hooks = {}) {
    this.engine = engine;
    this.settings = { ...DEFAULT_VOICE_SETTINGS, ...settings };
    this.now = hooks.now || (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
    this.onCaption = hooks.onCaption || (() => {});
    this.onSpeakStart = hooks.onSpeakStart || (() => {});
    this.maxQueueAgeMs = hooks.maxQueueAgeMs ?? 3000;
    this.current = null;
    this.pending = null;
    this.watchdog = null;
    this.counters = { requested: 0, spoken: 0, interrupted: 0, droppedStale: 0, droppedReplaced: 0, muted: 0 };
    this.latencies = [];
    this.engineLatencies = [];
  }

  get available() {
    return !!this.engine && this.engine.isAvailable();
  }

  updateSettings(partial) {
    this.settings = { ...this.settings, ...partial };
    if (!this.settings.enabled) this.cancelAll();
  }

  /** Accepts one utterance request (see FeedbackController.make). */
  say(utt) {
    this.counters.requested += 1;
    this.onCaption(utt);
    if (!this.settings.enabled || !this.available) {
      this.counters.muted += 1;
      return;
    }
    if (!this.current) {
      this.play(utt);
      return;
    }
    if (utt.interrupt || utt.priority >= this.current.priority + INTERRUPT_MARGIN) {
      this.counters.interrupted += 1;
      this.pending = null;
      this.stopCurrent();
      this.play(utt);
      return;
    }
    if (!this.pending || utt.priority >= this.pending.priority) {
      if (this.pending) this.counters.droppedReplaced += 1;
      this.pending = utt;
    } else {
      this.counters.droppedReplaced += 1;
    }
  }

  sayAll(list) {
    for (const u of list) this.say(u);
  }

  /** Drop a queued utterance that has become irrelevant (call once per processed frame). */
  revalidate() {
    if (this.pending && !this.isPlayable(this.pending)) {
      this.counters.droppedStale += 1;
      this.pending = null;
    }
  }

  cancelAll() {
    this.pending = null;
    this.stopCurrent();
  }

  stats() {
    const xs = [...this.latencies].sort((a, b) => a - b);
    const mean = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
    const p95 = xs.length ? xs[Math.min(xs.length - 1, Math.floor(xs.length * 0.95))] : null;
    return {
      ...this.counters,
      // End-to-end: error detected -> speech audibly starts (includes waiting behind another sentence).
      latencyMs: { samples: xs.length, mean: mean == null ? null : Math.round(mean), p95: p95 == null ? null : Math.round(p95), last: this.latencies.at(-1) ?? null },
      // TTS engine only: speak() called -> speech starts.
      engineLatencyMs: summarize(this.engineLatencies),
    };
  }

  // ------------------------------------------------------------------ internals

  isPlayable(utt) {
    const age = this.now() - utt.createdAt;
    if (age > (utt.maxAgeMs ?? this.maxQueueAgeMs)) return false;
    if (typeof utt.isValid === "function" && !utt.isValid()) return false;
    return true;
  }

  play(utt) {
    this.current = utt;
    const token = {};
    this.currentToken = token;
    const done = () => {
      if (this.currentToken !== token) return; // a newer utterance already took over
      clearTimeout(this.watchdog);
      this.current = null;
      this.currentToken = null;
      this.playNext();
    };
    // Some engines (notably Chrome's) occasionally never fire onend; don't let that wedge the queue.
    const expectedMs = 1500 + (utt.text.length * 85) / (this.settings.rate || 1);
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(done, expectedMs + 2000);

    const { rate, volume, pitch, lang, voiceId } = this.settings;
    const playAt = this.now();
    try {
      this.engine.speak(utt.text, { rate, volume, pitch, lang, voiceId }, {
        onStart: () => {
          if (this.currentToken !== token) return;
          this.counters.spoken += 1;
          const latency = this.now() - utt.detectedAt;
          this.latencies.push(Math.round(latency));
          this.engineLatencies.push(Math.round(this.now() - playAt));
          if (this.latencies.length > 200) this.latencies.shift();
          if (this.engineLatencies.length > 200) this.engineLatencies.shift();
          this.onSpeakStart(utt, latency);
        },
        onEnd: done,
        onError: done,
      });
    } catch {
      done();
    }
  }

  playNext() {
    const next = this.pending;
    this.pending = null;
    if (!next) return;
    if (!this.isPlayable(next)) {
      this.counters.droppedStale += 1;
      return;
    }
    this.play(next);
  }

  stopCurrent() {
    clearTimeout(this.watchdog);
    this.current = null;
    this.currentToken = null;
    try {
      this.engine?.cancel();
    } catch {
      // ignore engine errors on cancel
    }
  }
}

function summarize(values) {
  if (!values.length) return { samples: 0, mean: null, p95: null };
  const xs = [...values].sort((a, b) => a - b);
  return {
    samples: xs.length,
    mean: Math.round(xs.reduce((a, b) => a + b, 0) / xs.length),
    p95: xs[Math.min(xs.length - 1, Math.floor(xs.length * 0.95))],
  };
}
