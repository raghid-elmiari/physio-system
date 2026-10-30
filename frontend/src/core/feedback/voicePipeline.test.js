// End-to-end tests of the real-time correction loop, without a camera or a backend:
// synthetic landmarks -> evaluator -> FeedbackController -> VoiceCoach -> fake TTS engine.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEvaluator, ERROR_CATALOG, REFINED_MESSAGES, VOICE_PROMPTS } from "../exercises/shoulderAbduction.js";
import { goodRepKeyframes, interpolateTimeline } from "../testing/syntheticPose.js";
import { FeedbackController } from "./FeedbackController.js";
import { VoiceCoach } from "../voice/VoiceCoach.js";
import { LANDMARK as L } from "../pose/landmarks.js";

/** Fake TTS: starts after `startDelayMs`, lasts ~55 ms per character. Records what was said. */
function fakeEngine({ startDelayMs = 30 } = {}) {
  const log = [];
  let active = null;
  return {
    log,
    isAvailable: () => true,
    speak(text, _opts, cb) {
      const entry = { text, cancelled: false };
      active = entry;
      log.push(entry);
      entry.startTimer = setTimeout(() => {
        if (entry.cancelled) return;
        cb.onStart();
        entry.endTimer = setTimeout(() => {
          if (!entry.cancelled) cb.onEnd();
        }, text.length * 55);
      }, startDelayMs);
    },
    cancel() {
      if (active) {
        active.cancelled = true;
        clearTimeout(active.startTimer);
        clearTimeout(active.endTimer);
      }
    },
  };
}

function pipeline({ muted = false, targetReps = 10 } = {}) {
  // Fake timers also drive Date.now(), so the clock advances while timers fire.
  const base = Date.now();
  const clock = () => Date.now() - base;
  const engine = fakeEngine();
  const captions = [];
  const evaluator = createEvaluator({}, { targetReps });
  const feedback = new FeedbackController({}, { prompts: VOICE_PROMPTS, refinedMessages: REFINED_MESSAGES });
  const coach = new VoiceCoach(engine, { enabled: !muted }, { now: clock, onCaption: (u) => captions.push(u) });
  const run = (keyframes) => {
    const snaps = [];
    for (const frame of interpolateTimeline(keyframes, 30)) {
      vi.advanceTimersByTime(Math.max(0, frame.t - clock()));
      const ev = evaluator.update(frame);
      snaps.push(ev);
      coach.sayAll(feedback.process(ev));
      coach.revalidate();
    }
    vi.advanceTimersByTime(5000);
    return snaps;
  };
  const spoken = () => engine.log.filter((e) => !e.cancelled).map((e) => e.text);
  return { engine, coach, captions, run, spoken, evaluator };
}

const rest = (at, extra = {}) => ({ at, leftAbduction: 10, rightAbduction: 10, ...extra });
const up = (at, extra = {}) => ({ at, leftAbduction: 88, rightAbduction: 88, ...extra });

describe("real-time voice correction loop", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("speaks a specific correction, stays quiet while it persists, then confirms the fix", () => {
    const p = pipeline();
    p.run([
      rest(0), rest(800), rest(1000),
      up(2500), up(2800, { leftElbow: 120 }), // bend the left elbow at the top...
      up(6500, { leftElbow: 120 }), // ...and keep it bent for ~3.7 s
      up(6800), up(8500), // straighten it and hold
      rest(10000), rest(10600),
    ]);
    const said = p.spoken();
    expect(said.filter((s) => s === "Straighten your left elbow.")).toHaveLength(1); // no per-frame repetition
    const iCorr = said.indexOf("Straighten your left elbow.");
    const iConfirm = said.findIndex((s) => s === "Good, keep that position.");
    expect(iConfirm).toBeGreaterThan(iCorr);
    // The repetition is counted (criteria met) but not as correct, because the error occurred.
    expect(said).toContain("That's one.");
    expect(said).not.toContain("Good job! That's one repetition.");
  });

  it("repeats a persisting error with refined wording, at most three times", () => {
    const p = pipeline();
    p.run([rest(0), rest(800), rest(1000), up(2500), up(2800, { trunkLean: 18 }), up(40000, { trunkLean: 18 })]);
    const said = p.spoken();
    const corrections = said.filter((s) => s === ERROR_CATALOG.TRUNK_LEAN.message || s === REFINED_MESSAGES.TRUNK_LEAN);
    expect(corrections[0]).toBe(ERROR_CATALOG.TRUNK_LEAN.message);
    expect(corrections.slice(1).every((s) => s === REFINED_MESSAGES.TRUNK_LEAN)).toBe(true);
    expect(corrections).toHaveLength(3);
  });

  it("praises clean repetitions and announces set completion", () => {
    const p = pipeline({ targetReps: 2 });
    p.run([rest(0), rest(800), ...goodRepKeyframes(1000), ...goodRepKeyframes(6100)]);
    const said = p.spoken();
    expect(said).toContain(VOICE_PROMPTS.ready);
    expect(said).toContain("Good job! That's one repetition.");
    expect(said).toContain("Excellent work! You have completed your set.");
    expect(said.some((s) => /keep your|straighten|slow down/i.test(s))).toBe(false);
  });

  it("gives no movement corrections while tracking is unreliable, only a positioning prompt", () => {
    const p = pipeline();
    const hidden = [L.left_wrist, L.left_elbow, L.left_hip];
    p.run([rest(0), rest(800), rest(1000), up(2000), up(2100, { hidden, leftElbow: 100, trunkLean: 20 }), up(6000, { hidden, leftElbow: 100, trunkLean: 20 })]);
    const said = p.spoken();
    expect(said.some((s) => /elbow|back straight/i.test(s))).toBe(false);
    expect(said).toContain("Step back so your hips are visible.");
  });

  it("drops a queued correction that is no longer true when it would have played", () => {
    let now = 0;
    const engine = fakeEngine();
    const coach = new VoiceCoach(engine, {}, { now: () => now });
    let errorActive = true;
    coach.say({ id: "a", kind: "prompt", text: "A fairly long introduction sentence that takes a while.", priority: 45, createdAt: 0, detectedAt: 0, maxAgeMs: 5000 });
    coach.say({ id: "b", kind: "correction", text: "Keep your back straight.", priority: 50, createdAt: 0, detectedAt: 0, maxAgeMs: 5000, isValid: () => errorActive });
    errorActive = false; // patient corrected before the intro finished
    vi.advanceTimersByTime(4000);
    now = 4000;
    coach.revalidate();
    vi.advanceTimersByTime(4000);
    expect(engine.log.map((e) => e.text)).toEqual(["A fairly long introduction sentence that takes a while."]);
    expect(coach.stats().droppedStale).toBe(1);
  });

  it("interrupts a low-priority utterance for an urgent one", () => {
    const engine = fakeEngine();
    const coach = new VoiceCoach(engine, {}, { now: () => 0 });
    coach.say({ id: "r", kind: "rep", text: "Good job! That's three.", priority: 40, createdAt: 0, detectedAt: 0 });
    coach.say({ id: "c", kind: "complete", text: "Excellent work! You have completed your set.", priority: 100, interrupt: true, createdAt: 0, detectedAt: 0 });
    vi.advanceTimersByTime(5000);
    expect(engine.log[0].cancelled).toBe(true);
    expect(engine.log.filter((e) => !e.cancelled).map((e) => e.text)).toEqual(["Excellent work! You have completed your set."]);
    expect(coach.stats().interrupted).toBe(1);
  });

  it("when muted, speaks nothing but still emits every message as a caption", () => {
    const p = pipeline({ muted: true });
    p.run([rest(0), rest(800), rest(1000), up(2500), up(2800, { leftElbow: 120 }), up(5000, { leftElbow: 120 })]);
    expect(p.engine.log).toHaveLength(0);
    expect(p.captions.map((c) => c.text)).toContain("Straighten your left elbow.");
  });

  it("measures detection-to-speech latency", () => {
    const p = pipeline();
    p.run([rest(0), rest(800), rest(1000), up(2500), up(2800, { leftElbow: 120 }), up(4500, { leftElbow: 120 })]);
    const { latencyMs } = p.coach.stats();
    expect(latencyMs.samples).toBeGreaterThan(0);
    // fake engine start delay is 30 ms; frames arrive every 33 ms
    expect(latencyMs.mean).toBeLessThan(100);
    expect(p.coach.stats().engineLatencyMs.mean).toBe(30);
  });
});
