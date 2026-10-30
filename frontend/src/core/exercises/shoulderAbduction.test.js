import { describe, expect, it } from "vitest";
import { createEvaluator } from "./shoulderAbduction.js";
import { goodRepKeyframes, interpolateTimeline, syntheticFrontPose } from "../testing/syntheticPose.js";
import { LANDMARK as L } from "../pose/landmarks.js";

function run(keyframes, opts = {}) {
  const ev = createEvaluator({}, { targetReps: opts.targetReps ?? 10 });
  const out = [];
  for (const f of interpolateTimeline(keyframes, 30)) out.push(ev.update(f));
  const events = out.flatMap((o) => o.events);
  return { ev, out, events, last: out[out.length - 1] };
}

const rest = (at, extra = {}) => ({ at, leftAbduction: 10, rightAbduction: 10, ...extra });

describe("geometry of the synthetic pose", () => {
  it("produces the requested abduction angle", () => {
    const ev = createEvaluator();
    const snap = ev.update({ t: 0, landmarks: syntheticFrontPose({ leftAbduction: 60, rightAbduction: 30 }), width: 1, height: 1 });
    expect(snap.metrics.leftAbductionDeg).toBeCloseTo(60, 0);
    expect(snap.metrics.rightAbductionDeg).toBeCloseTo(30, 0);
    expect(snap.metrics.leftElbowDeg).toBeCloseTo(178, 0);
  });
});

describe("shoulder abduction evaluator", () => {
  it("counts clean repetitions as correct", () => {
    const kf = [rest(0), rest(800), ...goodRepKeyframes(1000), ...goodRepKeyframes(6100)];
    const { last, events } = run(kf);
    expect(events.some((e) => e.type === "READY")).toBe(true);
    expect(last.repCount).toBe(2);
    expect(last.correctReps).toBe(2);
    expect(events.filter((e) => e.type === "REP_COMPLETED").map((e) => e.correct)).toEqual([true, true]);
    expect(events.some((e) => e.type === "ERROR_STARTED")).toBe(false);
    expect(last.phase).toBe("REST");
  });

  it("does not count a repetition that never reaches shoulder height", () => {
    const kf = [rest(0), rest(800), rest(1000), { at: 2500, leftAbduction: 60, rightAbduction: 60 }, { at: 4500, leftAbduction: 60, rightAbduction: 60 }, rest(6000), rest(6500)];
    const { last, events } = run(kf);
    expect(last.repCount).toBe(0);
    const inc = events.find((e) => e.type === "REP_INCOMPLETE");
    expect(inc.reason).toBe("RANGE_TOO_LOW");
    // Stalling below target produced a live "lift higher" correction
    expect(events.some((e) => e.type === "ERROR_STARTED" && e.code === "RANGE_TOO_LOW")).toBe(true);
  });

  it("does not count a repetition without the hold at the top", () => {
    const kf = [rest(0), rest(800), rest(1000), { at: 2200, leftAbduction: 88, rightAbduction: 88 }, { at: 2500, leftAbduction: 88, rightAbduction: 88 }, rest(3800), rest(4300)];
    const { last, events } = run(kf);
    expect(last.repCount).toBe(0);
    expect(events.find((e) => e.type === "REP_INCOMPLETE").reason).toBe("HOLD_TOO_SHORT");
  });

  it("flags bent elbows (side-specific) and marks the repetition incorrect", () => {
    const kf = [rest(0), rest(800), ...goodRepKeyframes(1000, { up: { leftElbow: 120 } })];
    const { last, events } = run(kf);
    const err = events.find((e) => e.type === "ERROR_STARTED" && e.code === "ELBOW_BENT");
    expect(err).toBeDefined();
    expect(err.message).toBe("Straighten your left elbow.");
    expect(last.repCount).toBe(1);
    expect(last.correctReps).toBe(0);
    expect(events.find((e) => e.type === "REP_COMPLETED").errors).toContain("ELBOW_BENT");
  });

  it("detects lateral trunk lean and its resolution", () => {
    const kf = [
      rest(0), rest(800), rest(1000),
      { at: 2500, leftAbduction: 88, rightAbduction: 88, trunkLean: 0 },
      { at: 2800, leftAbduction: 88, rightAbduction: 88, trunkLean: 18 },
      { at: 3800, leftAbduction: 88, rightAbduction: 88, trunkLean: 18 },
      { at: 4000, leftAbduction: 88, rightAbduction: 88, trunkLean: 0 },
      { at: 5000, leftAbduction: 88, rightAbduction: 88, trunkLean: 0 },
      rest(6500), rest(7000),
    ];
    const { events } = run(kf);
    const started = events.findIndex((e) => e.type === "ERROR_STARTED" && e.code === "TRUNK_LEAN");
    const resolved = events.findIndex((e) => e.type === "ERROR_RESOLVED" && e.code === "TRUNK_LEAN");
    expect(started).toBeGreaterThan(-1);
    expect(resolved).toBeGreaterThan(started);
  });

  it("detects uneven arms and names the lower arm", () => {
    const kf = [rest(0), rest(800), rest(1000), { at: 2500, leftAbduction: 55, rightAbduction: 90 }, { at: 3500, leftAbduction: 55, rightAbduction: 90 }, rest(5000), rest(5500)];
    const { events } = run(kf);
    const e = events.find((x) => x.type === "ERROR_STARTED" && x.code === "UNEVEN_ARMS");
    expect(e.message).toBe("Lift your left arm a little higher to match your right.");
  });

  it("flags movement that is too fast", () => {
    const kf = [rest(0), rest(800), rest(1000), { at: 1300, leftAbduction: 88, rightAbduction: 88 }, { at: 2600, leftAbduction: 88, rightAbduction: 88 }, rest(2900), rest(3500)];
    const { events } = run(kf);
    expect(events.some((e) => e.type === "ERROR_STARTED" && e.code === "MOVING_TOO_FAST")).toBe(true);
  });

  it("asks the patient to return to the start position before the first rep", () => {
    const kf = [{ at: 0, leftAbduction: 70, rightAbduction: 70 }, { at: 2500, leftAbduction: 70, rightAbduction: 70 }];
    const { events, last } = run(kf);
    expect(events.some((e) => e.type === "ERROR_STARTED" && e.code === "NOT_AT_START")).toBe(true);
    expect(last.phase).toBe("SETUP");
  });

  it("gives no corrections while required landmarks are not visible, and abandons the rep", () => {
    const hidden = [L.left_wrist, L.left_elbow];
    const kf = [
      rest(0), rest(800), rest(1000),
      { at: 2000, leftAbduction: 88, rightAbduction: 88 },
      { at: 2100, leftAbduction: 88, rightAbduction: 88, leftElbow: 100, hidden },
      { at: 5000, leftAbduction: 88, rightAbduction: 88, leftElbow: 100, hidden },
    ];
    const { out, events, last } = run(kf);
    const lostIdx = events.findIndex((e) => e.type === "TRACKING_LOST");
    expect(lostIdx).toBeGreaterThan(-1);
    expect(events.slice(lostIdx).some((e) => e.type === "ERROR_STARTED")).toBe(false);
    expect(events.some((e) => e.type === "REP_ABANDONED")).toBe(true);
    expect(last.status).toBe("UNKNOWN");
    expect(last.activeErrors).toEqual([]);
    expect(last.trackingIssue.message).toMatch(/both arms/);
    expect(out.some((o) => o.trackable === false && o.activeErrors.length > 0)).toBe(false);
  });

  it("ignores a single-frame landmark glitch", () => {
    const ev = createEvaluator();
    const frames = interpolateTimeline([rest(0), rest(800), ...goodRepKeyframes(1000)], 30);
    // Corrupt one frame mid-hold with a wildly bent elbow
    const glitch = frames.findIndex((f) => f.t > 3000);
    frames[glitch] = { ...frames[glitch], landmarks: syntheticFrontPose({ leftAbduction: 88, rightAbduction: 88, leftElbow: 60 }) };
    const events = frames.flatMap((f) => ev.update(f).events);
    expect(events.some((e) => e.type === "ERROR_STARTED")).toBe(false);
    expect(events.find((e) => e.type === "REP_COMPLETED").correct).toBe(true);
  });

  it("emits SET_COMPLETE when the target is reached", () => {
    const kf = [rest(0), rest(800), ...goodRepKeyframes(1000), ...goodRepKeyframes(6100)];
    const { events } = run(kf, { targetReps: 2 });
    expect(events.filter((e) => e.type === "SET_COMPLETE")).toHaveLength(1);
  });

  it("respects server-provided threshold overrides", () => {
    const ev = createEvaluator({ targetAngle: 100 }, { targetReps: 5 });
    const events = interpolateTimeline([rest(0), rest(800), ...goodRepKeyframes(1000)], 30).flatMap((f) => ev.update(f).events);
    expect(events.some((e) => e.type === "REP_COMPLETED")).toBe(false);
    expect(ev.config.targetAngle).toBe(100);
  });
});
