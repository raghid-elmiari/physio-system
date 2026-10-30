// Decides WHEN and WHAT the coach should say, from the stream of evaluator snapshots.
// It never speaks itself: it returns utterance requests that a VoiceCoach plays (or that
// the UI shows as captions when voice is muted). Pure logic, time injected -> testable.
//
// Policy
//  * Only errors the evaluator reports as active (already debounced by ErrorDetector) are
//    eligible, and only while tracking is reliable.
//  * One correction at a time: the highest-priority active error.
//  * Per-error cooldown, plus a global minimum gap between corrections.
//  * A persisting error is repeated after repeatAfterMs, at most maxRepeatsPerError times,
//    using the error's refined wording on repeats when the exercise provides one.
//  * When a spoken error is corrected and stays corrected for confirmDelayMs (with no other
//    error active), the coach confirms ("Good, keep that position.").
//  * Each utterance carries isValid(): the VoiceCoach drops queued corrections whose error
//    is no longer present, so outdated instructions are never played late.

const DEFAULTS = Object.freeze({
  minGapMs: 2000, // between any two corrections
  cooldownMs: 6000, // before the same error may be spoken again after it was resolved
  repeatAfterMs: 8000, // re-prompt for an error that persists
  maxRepeatsPerError: 3, // per continuous occurrence
  confirmDelayMs: 700, // error must stay fixed this long before praise
  confirmWindowMs: 20000, // only praise corrections of errors spoken this recently
  trackingPromptDelayMs: 1500,
  trackingRepeatMs: 8000,
  announceReps: true,
});

const CONFIRMATIONS = ["Good, keep that position.", "That's better.", "Good correction."];

let seq = 0;
const nextId = () => `utt-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export const PRIORITY = Object.freeze({
  COMPLETE: 100,
  TRACKING: 72,
  // corrections use the error's own priority (50..90)
  INCOMPLETE: 52,
  PROMPT: 45,
  REP: 40,
  CONFIRM: 30,
});

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
const spell = (n) => NUMBER_WORDS[n] ?? String(n);

export class FeedbackController {
  /**
   * @param {object} [options] overrides for DEFAULTS
   * @param {{prompts?: object, refinedMessages?: Record<string,string>}} [exercise]
   */
  constructor(options = {}, exercise = {}) {
    this.opts = { ...DEFAULTS, ...options };
    this.prompts = exercise.prompts || {};
    this.refined = exercise.refinedMessages || {};
    this.reset();
  }

  reset() {
    this.spoken = new Map(); // code -> {lastAt, count, occurrenceSince}
    this.lastCorrectionAt = -Infinity;
    this.pendingConfirm = null; // {code, at}
    this.trackingSince = null;
    this.trackingPromptAt = -Infinity;
    this.latest = null;
    this.confirmIdx = 0;
    this.readyAnnounced = false;
  }

  /** Utterance(s) to play when the session starts. */
  start(t) {
    return this.prompts.intro ? [this.make(t, "prompt", this.prompts.intro, PRIORITY.PROMPT, { maxAgeMs: 6000 })] : [];
  }

  /**
   * @param {object} ev evaluator snapshot
   * @returns {Array<object>} utterance requests, highest priority first
   */
  process(ev) {
    const t = ev.t;
    this.latest = ev;
    const out = [];
    const events = ev.events || [];
    const setComplete = events.find((e) => e.type === "SET_COMPLETE");

    for (const e of events) {
      switch (e.type) {
        case "SET_COMPLETE":
          out.push(this.make(t, "complete", "Excellent work! You have completed your set.", PRIORITY.COMPLETE, { interrupt: true, maxAgeMs: 10000 }));
          break;
        case "REP_COMPLETED":
          if (this.opts.announceReps && !setComplete) {
            const text = e.correct
              ? (e.repNumber === 1 ? "Good job! That's one repetition." : `Good job! That's ${spell(e.repNumber)}.`)
              : `That's ${spell(e.repNumber)}.`;
            out.push(this.make(t, "rep", text, PRIORITY.REP, { maxAgeMs: 2500 }));
          }
          break;
        case "REP_INCOMPLETE": {
          const code = `INCOMPLETE_${e.reason}`;
          if (this.canSpeakCorrection(code, t, null)) {
            out.push(this.correction(t, code, e.message, PRIORITY.INCOMPLETE, null, () => true));
          }
          break;
        }
        case "REP_FEEDBACK": {
          // A counted repetition that was off in a way only visible once it was finished
          // (e.g. compared with a reference recording): explain it once, like an incomplete rep.
          const code = `REP_${e.code}`;
          if (this.canSpeakCorrection(code, t, null)) {
            out.push(this.correction(t, code, e.message, PRIORITY.INCOMPLETE, null, () => true));
          }
          break;
        }
        case "READY":
          if (!this.readyAnnounced && this.prompts.ready) {
            this.readyAnnounced = true;
            out.push(this.make(t, "prompt", this.prompts.ready, PRIORITY.PROMPT, { maxAgeMs: 4000 }));
          }
          break;
        case "HOLD_COMPLETE":
          if (this.prompts.holdComplete && (ev.activeErrors || []).length === 0) {
            out.push(this.make(t, "prompt", this.prompts.holdComplete, PRIORITY.PROMPT - 1, { maxAgeMs: 1500 }));
          }
          break;
        case "ERROR_RESOLVED": {
          const s = this.spoken.get(e.code);
          if (s) {
            s.count = 0;
            s.occurrenceSince = null;
            if (t - s.lastAt <= this.opts.confirmWindowMs) this.pendingConfirm = { code: e.code, at: t };
          }
          break;
        }
        default:
          break;
      }
    }

    // ---- unreliable tracking: no corrections, only a (rate-limited) positioning prompt
    if (!ev.trackable) {
      this.pendingConfirm = null;
      this.trackingSince ??= t;
      if (ev.trackingIssue && t - this.trackingSince >= this.opts.trackingPromptDelayMs
          && t - this.trackingPromptAt >= this.opts.trackingRepeatMs) {
        this.trackingPromptAt = t;
        out.push(this.make(t, "tracking", ev.trackingIssue.message, PRIORITY.TRACKING, {
          maxAgeMs: 3000,
          isValid: () => this.latest && !this.latest.trackable,
        }));
      }
      return sortByPriority(out);
    }
    this.trackingSince = null;

    const active = ev.activeErrors || [];

    // ---- confirmation after a successful correction
    if (this.pendingConfirm) {
      const { code, at } = this.pendingConfirm;
      if (active.some((a) => a.code === code)) {
        this.pendingConfirm = null; // came back: no praise
      } else if (t - at >= this.opts.confirmDelayMs) {
        this.pendingConfirm = null;
        if (active.length === 0) {
          const text = CONFIRMATIONS[this.confirmIdx++ % CONFIRMATIONS.length];
          out.push(this.make(t, "confirm", text, PRIORITY.CONFIRM, {
            maxAgeMs: 2000,
            code,
            isValid: () => this.latest?.trackable && !(this.latest.activeErrors || []).some((a) => a.code === code),
          }));
        }
      }
    }

    // ---- correction for the most important active error
    const top = active[0];
    if (top && this.canSpeakCorrection(top.code, t, top.since)) {
      const s = this.spoken.get(top.code);
      const repeat = s && s.occurrenceSince === top.since && s.count > 0;
      const text = repeat && this.refined[top.code] ? this.refined[top.code] : top.message;
      out.push(this.correction(t, top.code, text, top.priority, top.since,
        () => this.latest?.trackable && (this.latest.activeErrors || []).some((a) => a.code === top.code)));
    }

    return sortByPriority(out);
  }

  canSpeakCorrection(code, t, occurrenceSince) {
    if (t - this.lastCorrectionAt < this.opts.minGapMs) return false;
    const s = this.spoken.get(code);
    if (!s) return true;
    const sameOccurrence = occurrenceSince != null && s.occurrenceSince === occurrenceSince;
    if (sameOccurrence) {
      return s.count < this.opts.maxRepeatsPerError && t - s.lastAt >= this.opts.repeatAfterMs;
    }
    return t - s.lastAt >= this.opts.cooldownMs;
  }

  correction(t, code, text, priority, occurrenceSince, isValid) {
    const s = this.spoken.get(code) || { lastAt: -Infinity, count: 0, occurrenceSince: null };
    if (s.occurrenceSince !== occurrenceSince) s.count = 0;
    s.lastAt = t;
    s.count += 1;
    s.occurrenceSince = occurrenceSince;
    this.spoken.set(code, s);
    this.lastCorrectionAt = t;
    if (this.pendingConfirm?.code === code) this.pendingConfirm = null;
    return this.make(t, "correction", text, priority, { code, maxAgeMs: 2500, isValid });
  }

  make(t, kind, text, priority, extra = {}) {
    return { id: nextId(), kind, text, priority, detectedAt: t, createdAt: t, interrupt: false, ...extra };
  }
}

function sortByPriority(list) {
  return list.sort((a, b) => b.priority - a.priority);
}
