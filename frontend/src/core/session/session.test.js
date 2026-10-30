import { describe, expect, it } from "vitest";
import { SessionRecorder, toLocalIso } from "./SessionRecorder.js";
import { createOfflineQueue, memoryStorage } from "../sync/offlineQueue.js";
import { createEvaluator, ERROR_CATALOG } from "../exercises/shoulderAbduction.js";
import { goodRepKeyframes, interpolateTimeline } from "../testing/syntheticPose.js";

describe("SessionRecorder", () => {
  it("builds the backend summary from evaluator output", () => {
    let t = 0;
    const rec = new SessionRecorder({ errorCatalog: ERROR_CATALOG, clock: () => t, wallClock: () => new Date(2026, 0, 1, 10, 0, 0) });
    const ev = createEvaluator({}, { targetReps: 5 });
    rec.start();
    const kf = [
      { at: 0, leftAbduction: 10, rightAbduction: 10 }, { at: 800, leftAbduction: 10, rightAbduction: 10 },
      ...goodRepKeyframes(1000),
      ...goodRepKeyframes(6100, { up: { rightElbow: 120 } }),
    ];
    for (const f of interpolateTimeline(kf, 30)) {
      t = f.t;
      rec.record(ev.update(f));
      rec.recordPerf({ inferenceMs: 20, fps: 30 });
    }
    const s = rec.summary(ev.summaryMetrics());
    expect(s.roundsCompleted).toBe(2);
    expect(s.correctReps).toBe(1);
    expect(s.errorCounts).toEqual({ ELBOW_BENT: 1 });
    expect(s.errorMessages.ELBOW_BENT).toBe("Keep your elbows straight.");
    expect(s.durationSeconds).toBe(11);
    expect(s.metrics.trackedFramePct).toBe(100);
    expect(s.metrics.meanInferenceMs).toBe(20);
    expect(s.metrics.peakAbductionDeg).toBeGreaterThan(80);
    expect(s.events.filter((e) => e.eventType === "REP_COMPLETED")).toHaveLength(2);
    expect(s.events.every((e) => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}$/.test(e.eventTimestamp))).toBe(true);
    expect(new Set(s.events.map((e) => e.eventUid)).size).toBe(s.events.length);
  });

  it("excludes paused time from the duration", () => {
    let t = 0;
    const rec = new SessionRecorder({ clock: () => t });
    rec.start();
    t = 10000;
    rec.pause();
    t = 60000;
    rec.resume();
    t = 65000;
    expect(rec.durationSeconds).toBe(15);
  });

  it("formats local timestamps without a zone", () => {
    expect(toLocalIso(new Date(2026, 9, 21, 9, 5, 7, 42))).toBe("2026-10-21T09:05:07.042");
  });
});

describe("offline queue", () => {
  it("keeps sessions until the upload succeeds and de-duplicates by clientSessionId", async () => {
    const q = createOfflineQueue(memoryStorage());
    q.enqueue({ clientSessionId: "a", exerciseId: 1 });
    q.enqueue({ clientSessionId: "b", exerciseId: 1 });
    q.enqueue({ clientSessionId: "a", exerciseId: 1 });
    expect(q.size()).toBe(2);

    const offline = await q.flush(async () => {
      throw new Error("Network Error");
    });
    expect(offline).toEqual({ synced: 0, failed: 0, remaining: 2 });

    const sent = [];
    const online = await q.flush(async (body) => {
      sent.push(body);
      return {};
    });
    expect(online).toEqual({ synced: 2, failed: 0, remaining: 0 });
    expect(sent.every((b) => !("queuedAt" in b))).toBe(true);
  });

  it("drops entries the server rejects as invalid but keeps auth failures", async () => {
    const q = createOfflineQueue(memoryStorage());
    q.enqueue({ clientSessionId: "bad" });
    q.enqueue({ clientSessionId: "later" });
    const r1 = await q.flush(async (b) => {
      throw { response: { status: b.clientSessionId === "bad" ? 400 : 401 } };
    });
    expect(r1).toEqual({ synced: 0, failed: 1, remaining: 1 });
    expect(q.list()[0].clientSessionId).toBe("later");
  });
});
