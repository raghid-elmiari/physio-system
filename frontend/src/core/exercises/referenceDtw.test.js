import { describe, expect, it } from "vitest";
import { analyzeRecording, buildReference } from "../reference/buildReference.js";
import { createEvaluator, ERROR_CATALOG, checksFor } from "./referenceDtw.js";
import { FeedbackController } from "../feedback/FeedbackController.js";
import { goodRepKeyframes, interpolateTimeline } from "../testing/syntheticPose.js";

const rest = (at, extra = {}) => ({ at, leftAbduction: 10, rightAbduction: 10, ...extra });

/** Keyframes of `count` repetitions; `scale` stretches each repetition in time. */
function reps(count, { start = 1000, scale = 1, up = {}, extra = {} } = {}) {
  const kf = [rest(0, extra), rest(start - 200, extra)];
  let t = start;
  for (let i = 0; i < count; i++) {
    const rep = goodRepKeyframes(0, { ...extra, up: { ...extra, ...up } }).map((k) => ({ ...k, at: t + k.at * scale }));
    kf.push(...rep);
    t = rep[rep.length - 1].at + 300;
  }
  kf.push(rest(t, extra), rest(t + 800, extra));
  return kf;
}

// The therapist's demonstration: three clean shoulder raises.
const demo = interpolateTimeline(reps(3), 30);
const analysis = analyzeRecording(demo);
const reference = buildReference(analysis);

function run(keyframes, config = {}) {
  const ev = createEvaluator({ reference, ...config }, { targetReps: 10 });
  const out = interpolateTimeline(keyframes, 30).map((f) => ev.update({ ...f, t: f.t + 10 }));
  const events = out.flatMap((o) => o.events);
  return { ev, events, last: out[out.length - 1] };
}

describe("reference builder", () => {
  it("finds the moving joints and the repetitions in a demonstration", () => {
    expect(["left_shoulder", "right_shoulder"]).toContain(analysis.primary);
    expect(analysis.moving).toEqual(expect.arrayContaining(["left_shoulder", "right_shoulder"]));
    expect(analysis.reps).toHaveLength(3);
    // Arms move -> elbows (same limb) and trunk posture are checked too.
    expect(reference.features).toEqual(expect.arrayContaining(["left_elbow", "right_elbow", "trunk_lean"]));
    expect(reference.restValue).toBeLessThan(20);
    expect(reference.peakValue).toBeGreaterThan(80);
    expect(reference.stats.dtwThresholdDeg).toBeGreaterThanOrEqual(8);
  });

  it("keeps only derived angles and stays small enough to store as JSON", () => {
    const json = JSON.stringify(reference);
    expect(json.length).toBeLessThan(60000);
    expect(json).not.toContain("landmarks");
  });

  it("can drop repetitions and joints the therapist does not want", () => {
    const r = buildReference(analysis, { repIndices: [0], features: [] });
    expect(r.reps).toHaveLength(1);
    expect(r.features).toEqual([analysis.primary]);
  });
});

describe("reference-matching analyzer", () => {
  it("counts repetitions that match the reference as correct", () => {
    const { events, last } = run(reps(2));
    expect(last.repCount).toBe(2);
    expect(last.correctReps).toBe(2);
    const done = events.filter((e) => e.type === "REP_COMPLETED");
    expect(done.every((e) => e.matchScore >= 70)).toBe(true);
    expect(events.some((e) => e.type === "ERROR_STARTED")).toBe(false);
  });

  it("tolerates a slower but correct repetition (DTW aligns the timing)", () => {
    const { last } = run(reps(1, { scale: 1.8 }));
    expect(last.repCount).toBe(1);
    expect(last.correctReps).toBe(1);
  });

  it("names the joint that differs from the reference", () => {
    const { events, last } = run(reps(1, { up: { leftElbow: 115 } }));
    expect(events.some((e) => e.type === "ERROR_STARTED" && e.code === "LEFT_ELBOW_LOW")).toBe(true);
    expect(last.correctReps).toBe(0);
    const done = events.find((e) => e.type === "REP_COMPLETED");
    expect(done.errors).toContain("LEFT_ELBOW_LOW");
  });

  it("holds posture to a tighter tolerance than moving joints (side lean)", () => {
    const kf = [rest(0), rest(800), { at: 1000, leftAbduction: 10, rightAbduction: 10 }, { at: 2500, leftAbduction: 88, rightAbduction: 88 },
      { at: 2800, leftAbduction: 88, rightAbduction: 88, trunkLean: 16 }, { at: 5000, leftAbduction: 88, rightAbduction: 88, trunkLean: 16 },
      { at: 5300, leftAbduction: 88, rightAbduction: 88 }, rest(6800), rest(7600)];
    const { events } = run(kf);
    expect(events.some((e) => e.type === "ERROR_STARTED" && e.code === "TRUNK_LEAN_HIGH")).toBe(true);
    expect(events.find((e) => e.type === "REP_COMPLETED").correct).toBe(false);
  });

  it("does not count a repetition that stops well short of the reference range", () => {
    const kf = [rest(0), rest(800), rest(1000), { at: 2500, leftAbduction: 50, rightAbduction: 50 }, { at: 4500, leftAbduction: 50, rightAbduction: 50 }, rest(6000), rest(6800)];
    const { events, last } = run(kf);
    expect(last.repCount).toBe(0);
    expect(events.some((e) => e.type === "REP_INCOMPLETE" && e.reason === "RANGE_TOO_LOW")).toBe(true);
  });

  it("flags a repetition done much faster than the reference and explains it", () => {
    const { events } = run(reps(1, { scale: 0.35 }));
    const done = events.find((e) => e.type === "REP_COMPLETED");
    expect(done.correct).toBe(false);
    expect(done.errors).toEqual(expect.arrayContaining(["REP_TOO_FAST"]));

    const fb = new FeedbackController();
    const utterances = fb.process({ t: 0, trackable: true, activeErrors: [], events: events.filter((e) => e.type === "REP_FEEDBACK") });
    expect(utterances.map((u) => u.text)).toContain(ERROR_CATALOG.REP_TOO_FAST.message);
  });

  it("refuses to start without a reference and describes what it checks", () => {
    expect(() => createEvaluator({})).toThrow(/reference/);
    expect(checksFor({ reference })[0]).toMatch(/3 reference repetitions/);
  });
});
