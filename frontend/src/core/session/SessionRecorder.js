// Collects what the backend needs from a monitored session: counts, durations, error
// frequencies, a bounded event log and aggregate metrics. Only derived data is kept —
// never frames, video or per-frame landmarks.

const MAX_EVENTS = 2000;

function uid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** ISO-8601 local date-time without zone, matching the backend's LocalDateTime fields. */
export function toLocalIso(date) {
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

export class SessionRecorder {
  /**
   * @param {{errorCatalog?: Record<string,{message:string}>, clock?: () => number, wallClock?: () => Date}} opts
   *   clock: monotonic ms (same base as evaluator timestamps); wallClock: real date for event timestamps
   */
  constructor({ errorCatalog = {}, clock, wallClock } = {}) {
    this.errorCatalog = errorCatalog;
    this.clock = clock || (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
    this.wallClock = wallClock || (() => new Date());
    this.events = [];
    this.seq = 0;
    this.errorCounts = {};
    this.frames = 0;
    this.trackedFrames = 0;
    this.qualitySum = 0;
    this.perf = { samples: 0, inferenceMsSum: 0, fpsSum: 0 };
    this.startedAtWall = null;
    this.startedAt = null;
    this.activeMs = 0;
    this.runningSince = null;
    this.repCount = 0;
    this.correctReps = 0;
  }

  start() {
    this.startedAtWall = this.wallClock();
    this.startedAt = this.clock();
    this.runningSince = this.startedAt;
  }

  pause() {
    if (this.runningSince != null) {
      this.activeMs += this.clock() - this.runningSince;
      this.runningSince = null;
    }
  }

  resume() {
    if (this.runningSince == null) this.runningSince = this.clock();
  }

  get durationSeconds() {
    const running = this.runningSince != null ? this.clock() - this.runningSince : 0;
    return Math.round((this.activeMs + running) / 1000);
  }

  /** Feed every evaluator snapshot. */
  record(ev) {
    this.frames += 1;
    if (ev.trackable) {
      this.trackedFrames += 1;
      this.qualitySum += ev.trackingQuality ?? 0;
    }
    this.repCount = ev.repCount;
    this.correctReps = ev.correctReps;
    for (const e of ev.events || []) this.recordEvent(e);
  }

  recordPerf({ inferenceMs, fps }) {
    if (!Number.isFinite(inferenceMs)) return;
    this.perf.samples += 1;
    this.perf.inferenceMsSum += inferenceMs;
    this.perf.fpsSum += Number.isFinite(fps) ? fps : 0;
  }

  recordEvent(e) {
    let mapped = null;
    switch (e.type) {
      case "REP_COMPLETED":
        mapped = { eventType: "REP_COMPLETED", repNumber: e.repNumber, value: e.peakAngle, message: e.correct ? "correct" : `errors: ${e.errors.join(",")}` };
        break;
      case "REP_INCOMPLETE":
        mapped = { eventType: "REP_INCOMPLETE", errorCode: e.reason, value: e.peakAngle, message: e.message };
        break;
      case "ERROR_STARTED":
        this.errorCounts[e.code] = (this.errorCounts[e.code] || 0) + 1;
        mapped = { eventType: "ERROR", errorCode: e.code, jointName: e.side || null, message: e.message };
        break;
      case "REP_FEEDBACK":
        this.errorCounts[e.code] = (this.errorCounts[e.code] || 0) + 1;
        mapped = { eventType: "ERROR", errorCode: e.code, repNumber: e.repNumber, message: e.message };
        break;
      case "TRACKING_LOST":
        mapped = { eventType: "TRACKING_LOST", message: e.message };
        break;
      default:
        return;
    }
    if (this.events.length >= MAX_EVENTS) return;
    this.seq += 1;
    this.events.push({
      eventUid: uid(),
      sequenceNo: this.seq,
      eventTimestamp: toLocalIso(this.wallTimeFor(e.t)),
      ...mapped,
      message: mapped.message ? String(mapped.message).slice(0, 255) : null,
    });
  }

  wallTimeFor(t) {
    if (this.startedAtWall == null || this.startedAt == null || !Number.isFinite(t)) return this.wallClock();
    return new Date(this.startedAtWall.getTime() + (t - this.startedAt));
  }

  /**
   * Body for POST /api/sessions/{id}/complete (and the `summary` of POST /api/sessions/sync).
   * @param {object} extraMetrics exercise- and device-specific metrics to include
   */
  summary(extraMetrics = {}) {
    const errorMessages = {};
    for (const code of Object.keys(this.errorCounts)) {
      errorMessages[code] = this.errorCatalog[code]?.message ?? code;
    }
    const n = this.perf.samples;
    return {
      roundsCompleted: this.repCount,
      correctReps: this.correctReps,
      durationSeconds: this.durationSeconds,
      errorCounts: { ...this.errorCounts },
      errorMessages,
      metrics: {
        trackedFramePct: this.frames ? Math.round((this.trackedFrames / this.frames) * 1000) / 10 : null,
        meanTrackingQuality: this.trackedFrames ? Math.round((this.qualitySum / this.trackedFrames) * 1000) / 1000 : null,
        meanInferenceMs: n ? Math.round((this.perf.inferenceMsSum / n) * 10) / 10 : null,
        meanProcessedFps: n ? Math.round((this.perf.fpsSum / n) * 10) / 10 : null,
        ...extraMetrics,
      },
      events: this.events,
    };
  }
}
