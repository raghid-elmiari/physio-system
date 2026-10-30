// Reference-matching analyzer: compares the patient with a therapist's recorded demonstration
// instead of hand-written rules, so a new exercise only needs a reference recording
// (built by core/reference/buildReference.js and stored in analysisConfig.reference).
//
// IMPORTANT: matching a reference is not a clinical judgement. A small distance means "close to
// this one recording"; the thresholds are a starting point a physiotherapist must review.
//
// Two levels of feedback
//   Live (every frame)  range, speed and joint positions compared with the reference at the
//                       same stage of the movement (envelope indexed by primary-joint progress).
//   Per repetition      when a repetition ends it is aligned to every reference repetition with
//                       DTW; the closest one gives the match score, the joint that was most off
//                       (and in which direction) and the tempo compared with the reference.
//
// Movement model on the primary joint (the one that moves most in the reference):
//   SETUP -> REST -> MOVING -> RETURNING -> REST ...
// progress = 0 at the reference rest angle, 1 at the reference peak angle.

import { assessTracking } from "../analysis/tracking.js";
import { ErrorDetector } from "../analysis/ErrorDetector.js";
import { dtw, featureDeviations, resample } from "../analysis/dtw.js";
import { Ema, RateEstimator } from "../pose/geometry.js";
import { FEATURES, FEATURE_KEYS, computeFeatures, deviationCode, landmarksFor } from "../reference/features.js";
import { ENVELOPE_BINS } from "../reference/buildReference.js";

export const ANALYZER_KEY = "reference_dtw";

export const DEFAULT_CONFIG = Object.freeze({
  minVisibility: 0.6,
  restProgress: 0.2, // must be below this to count as "at the starting position"
  startProgress: 0.25, // same thresholds the reference was segmented with
  endProgress: 0.15,
  minPeakProgress: 0.8, // must reach 80% of the reference range for the repetition to count
  overshootDeg: 20, // beyond the reference peak by more than this = too far
  featureToleranceDeg: {}, // per joint, e.g. {left_elbow: 20}; default from core/reference/features.js
  repFeatureToleranceDeg: 12, // mean deviation over an aligned repetition to name a joint
  dtwThresholdDeg: null, // null = use the value calibrated from the reference recording
  band: 0.25,
  speedFactor: 1.8, // faster than 1.8x the reference's fastest movement = uncontrolled
  minSpeedLimitDegPerSec: 90,
  tempoFastRatio: 0.55, // repetition shorter than 55% of the reference duration
  tempoSlowRatio: 2.2,
  plateauMs: 1200,
  startHoldMs: 500,
  errorPersistMs: 500,
  trackingGraceMs: 600,
  abandonRepAfterMs: 2000,
  maxRepFrames: 300,
});

export const PHASE_LABELS = Object.freeze({
  SETUP: "Get into position",
  REST: "Starting position",
  MOVING: "Moving",
  RETURNING: "Returning",
});

const BASE_ERRORS = {
  NOT_AT_START: { priority: 90, persistMs: 1500, message: "Return to the starting position shown by your therapist." },
  RANGE_TOO_HIGH: { priority: 72, message: "Not so far. Stop where the reference stops." },
  MOVING_TOO_FAST: { priority: 65, persistMs: 150, message: "Slow down and control the movement." },
  RANGE_TOO_LOW: { priority: 50, persistMs: 0, message: "Go a little further, as far as the reference." },
  // Per-repetition findings (reported after DTW, not live).
  REP_TOO_FAST: { priority: 48, message: "That repetition was too fast. Follow the reference tempo." },
  REP_TOO_SLOW: { priority: 46, message: "Try to keep a steady pace, like the reference." },
  REP_SHAPE: { priority: 47, message: "That repetition looked different from the reference. Watch the movement again." },
};

// One LOW/HIGH code per joint feature, so every possible deviation has a stable code.
const FEATURE_ERRORS = Object.fromEntries(
  FEATURE_KEYS.flatMap((key) => {
    const f = FEATURES[key];
    const priority = key === "trunk_lean" ? 85 : 70;
    return [
      [deviationCode(key, "low"), { priority, message: f.low, landmarks: f.highlight }],
      [deviationCode(key, "high"), { priority, message: f.high, landmarks: f.highlight }],
    ];
  })
);

export const ERROR_CATALOG = Object.freeze({ ...BASE_ERRORS, ...FEATURE_ERRORS });

export const INCOMPLETE_MESSAGES = Object.freeze({
  RANGE_TOO_LOW: "Go a little further next time, as far as the reference.",
});

/** Spoken prompts (used by the FeedbackController). */
export const VOICE_PROMPTS = Object.freeze({
  intro: "Get into the starting position shown in your therapist's recording.",
  ready: "Good. Start the movement now.",
});

export const REFINED_MESSAGES = Object.freeze({
  MOVING_TOO_FAST: "Move slowly, at the same pace as the reference.",
  RANGE_TOO_LOW: "A little further each time, until you match the reference.",
});

/** Plain-language list of what this exercise checks (exercise detail page). */
export function checksFor(config) {
  const ref = config?.reference;
  if (!ref) return ["No reference recording has been saved for this exercise yet."];
  const label = (k) => FEATURES[k]?.label.toLowerCase() ?? k;
  return [
    `Each repetition is compared with your therapist's recording (${ref.reps.length} reference repetition${ref.reps.length === 1 ? "" : "s"}).`,
    `Range of motion of the ${label(ref.primary)}, from about ${Math.round(ref.restValue)}° to ${Math.round(ref.peakValue)}°.`,
    ...ref.features.filter((k) => k !== ref.primary).map((k) => `Your ${label(k)} stays close to the reference.`),
    "Movement speed and tempo compared with the reference.",
  ];
}

/**
 * @param {object} overrides analysisConfig from the backend; must contain `reference`
 * @param {{targetReps?: number}} [options]
 */
export function createEvaluator(overrides = {}, { targetReps = 10 } = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...(overrides || {}) };
  const ref = cfg.reference;
  if (!ref || !Array.isArray(ref.reps) || !ref.reps.length || !ref.features?.length) {
    throw new Error("This exercise has no reference recording yet. Ask your therapist to record one.");
  }
  const keys = ref.features;
  const primary = ref.primary;
  const span = ref.peakValue - ref.restValue || 1;
  const dir = Math.sign(span);
  const threshold = cfg.dtwThresholdDeg ?? ref.stats?.dtwThresholdDeg ?? 10;
  const speedLimit = Math.max(cfg.minSpeedLimitDegPerSec, (ref.stats?.maxSpeedDegPerSec ?? 0) * cfg.speedFactor);
  const refDuration = ref.stats?.meanDurationMs ?? mean(ref.reps.map((r) => r.durationMs));
  const required = landmarksFor(keys);
  const errors = new ErrorDetector(ERROR_CATALOG, { persistMs: cfg.errorPersistMs });
  const smooth = Object.fromEntries(keys.map((k) => [k, new Ema(0.5)]));
  const rate = new RateEstimator(200);
  const progressOf = (v) => (v - ref.restValue) / span;

  const st = {
    phase: "SETUP",
    restSince: null,
    trackingLost: true,
    everTracked: false,
    lastTrackedT: null,
    rep: null,
    pre: [], // recent frames before a repetition starts (its first frames are just below startProgress)
    repCount: 0,
    correctReps: 0,
    incompleteReps: 0,
    setCompleteAnnounced: false,
    peaks: [],
    distances: [],
    scores: [],
    lastRep: null,
  };

  function snapshot(t, extra) {
    return {
      t,
      analyzerKey: ANALYZER_KEY,
      phase: st.phase,
      phaseLabel: PHASE_LABELS[st.phase],
      repCount: st.repCount,
      correctReps: st.correctReps,
      incompleteReps: st.incompleteReps,
      targetReps,
      ...extra,
    };
  }

  function update(frame) {
    const t = frame.t;
    const events = [];
    const tracking = assessTracking(frame.landmarks, required, { minVisibility: cfg.minVisibility });

    if (!tracking.trackable) {
      const sinceTracked = st.lastTrackedT == null ? Infinity : t - st.lastTrackedT;
      const message = tracking.reason === "NO_PERSON"
        ? "Stand in front of the camera so I can see you."
        : "Move so the joints being checked are fully visible in the frame.";
      if (!st.trackingLost && sinceTracked >= cfg.trackingGraceMs) {
        st.trackingLost = true;
        errors.clear();
        events.push({ type: "TRACKING_LOST", t, message });
      }
      if (st.trackingLost && st.rep && sinceTracked >= cfg.abandonRepAfterMs) {
        st.rep = null;
        st.phase = "SETUP";
        st.restSince = null;
        events.push({ type: "REP_ABANDONED", t });
      }
      return snapshot(t, {
        trackable: false,
        trackingQuality: tracking.quality,
        trackingIssue: st.trackingLost ? { code: tracking.reason, message } : null,
        status: "UNKNOWN",
        activeErrors: [],
        metrics: null,
        highlight: tracking.missing,
        events,
      });
    }

    if (st.trackingLost) {
      st.trackingLost = false;
      events.push({ type: st.everTracked ? "TRACKING_RESTORED" : "TRACKING_ACQUIRED", t });
      st.everTracked = true;
    }
    st.lastTrackedT = t;

    const rawValues = computeFeatures(frame, { minVisibility: cfg.minVisibility, keys });
    const values = {};
    for (const k of keys) values[k] = smooth[k].update(rawValues[k] ?? NaN, t);
    const vector = keys.map((k) => values[k]);
    const x = values[primary];
    const p = progressOf(x);
    const speed = rate.update(x, t);
    const conditions = [];
    const prevPhase = st.phase;

    switch (st.phase) {
      case "SETUP":
        if (p < cfg.restProgress) {
          st.restSince ??= t;
          if (t - st.restSince >= cfg.startHoldMs) {
            st.phase = "REST";
            events.push({ type: "READY", t });
          }
        } else {
          st.restSince = null;
          conditions.push({ code: "NOT_AT_START" });
        }
        break;
      case "REST":
        st.pre.push({ p, vector });
        if (st.pre.length > 60) st.pre.shift();
        if (p > cfg.startProgress) {
          st.phase = "MOVING";
          let from = st.pre.length - 1;
          while (from > 0 && st.pre[from].p >= cfg.endProgress) from--;
          st.rep = { start: t, frames: st.pre.slice(from).map((f) => f.vector), peakP: p, peak: x, errors: new Set(), plateauSince: null };
          st.pre = [];
        }
        break;
      case "MOVING":
      case "RETURNING": {
        const rep = st.rep;
        rep.frames.push(vector);
        if (p > rep.peakP) {
          rep.peakP = p;
          rep.peak = x;
        }
        if (st.phase === "MOVING" && p < rep.peakP - 0.2) st.phase = "RETURNING";
        if (st.phase === "MOVING" && rep.peakP < cfg.minPeakProgress && Math.abs(speed) < 15) {
          rep.plateauSince ??= t;
          if (t - rep.plateauSince >= cfg.plateauMs) conditions.push({ code: "RANGE_TOO_LOW" });
        } else {
          rep.plateauSince = null;
        }
        if (p < cfg.endProgress) {
          st.phase = "REST";
          finishRep(t, rep, events);
          st.rep = null;
        }
        break;
      }
      default:
        break;
    }

    // ---- live checks while moving, against the reference at the same stage of the movement
    if (st.phase === "MOVING" || st.phase === "RETURNING") {
      if ((x - ref.peakValue) * dir > cfg.overshootDeg) conditions.push({ code: "RANGE_TOO_HIGH" });
      if (Math.abs(speed) > speedLimit) conditions.push({ code: "MOVING_TOO_FAST" });
      const bin = Math.max(0, Math.min(ENVELOPE_BINS - 1, Math.round(Math.min(1, Math.max(0, p)) * (ENVELOPE_BINS - 1))));
      for (const k of keys) {
        if (k === primary) continue;
        const expected = ref.envelope?.[k]?.[bin];
        if (expected == null || !Number.isFinite(values[k])) continue;
        const diff = values[k] - expected;
        if (Math.abs(diff) > (cfg.featureToleranceDeg?.[k] ?? FEATURES[k].toleranceDeg)) conditions.push({ code: deviationCode(k, diff < 0 ? "low" : "high") });
      }
    }

    const { active, started, resolved } = errors.update(t, conditions);
    for (const e of started) events.push({ type: "ERROR_STARTED", t, code: e.code, message: e.message, priority: e.priority });
    for (const e of resolved) events.push({ type: "ERROR_RESOLVED", t, code: e.code, durationMs: e.durationMs });
    if (st.rep) for (const e of active) st.rep.errors.add(e.code);
    if (prevPhase !== st.phase) events.push({ type: "PHASE_CHANGED", t, from: prevPhase, to: st.phase });

    if (!st.setCompleteAnnounced && st.repCount >= targetReps) {
      st.setCompleteAnnounced = true;
      events.push({ type: "SET_COMPLETE", t, repCount: st.repCount, correctReps: st.correctReps });
    }

    const featureMetrics = Object.fromEntries(keys.map((k) => [k, round1(values[k])]));
    return snapshot(t, {
      trackable: true,
      trackingQuality: tracking.quality,
      trackingIssue: null,
      status: active.length ? "INCORRECT" : "CORRECT",
      activeErrors: active,
      metrics: {
        primary,
        primaryDeg: round1(x),
        progressToTarget: Math.max(0, Math.min(1, p)),
        angularSpeedDegPerSec: round1(speed),
        features: featureMetrics,
        lastRep: st.lastRep,
        display: [
          ...keys.map((k) => ({ label: FEATURES[k].label, value: fmtDeg(values[k]) })),
          { label: "Reference range", value: `${Math.round(ref.restValue)}° → ${Math.round(ref.peakValue)}°` },
          { label: "Last rep match", value: st.lastRep ? `${st.lastRep.matchScore}% (${st.lastRep.dtwDeg}° off)` : "—" },
        ],
      },
      highlight: active.flatMap((e) => e.landmarks),
      events,
    });
  }

  function finishRep(t, rep, events) {
    const durationMs = t - rep.start;
    if (rep.peakP < cfg.minPeakProgress) {
      st.incompleteReps += 1;
      events.push({ type: "REP_INCOMPLETE", t, reason: "RANGE_TOO_LOW", message: INCOMPLETE_MESSAGES.RANGE_TOO_LOW, peakAngle: round1(rep.peak) });
      return;
    }

    const live = rep.frames.length > cfg.maxRepFrames ? resample(rep.frames, cfg.maxRepFrames) : rep.frames;
    let best = null;
    for (const r of ref.reps) {
      const res = dtw(live, r.frames, { band: cfg.band });
      if (!best || res.normalized < best.res.normalized) best = { res, r };
    }
    const dtwDeg = round1(best.res.normalized);
    const matchScore = Math.round(100 * Math.exp((-dtwDeg * Math.log(1 / 0.7)) / threshold)); // threshold -> 70%

    // Which joint was most off once the two repetitions are aligned in time.
    const findings = [];
    const dev = featureDeviations(live, best.r.frames, best.res.path);
    let worst = -1;
    dev.forEach((d, i) => {
      if (Math.abs(d) > cfg.repFeatureToleranceDeg && (worst < 0 || Math.abs(d) > Math.abs(dev[worst]))) worst = i;
    });
    if (worst >= 0) findings.push(deviationCode(keys[worst], dev[worst] < 0 ? "low" : "high"));
    const tempo = durationMs / refDuration;
    if (tempo < cfg.tempoFastRatio) findings.push("REP_TOO_FAST");
    else if (tempo > cfg.tempoSlowRatio) findings.push("REP_TOO_SLOW");
    if (dtwDeg > threshold && !findings.length && !rep.errors.size) findings.push("REP_SHAPE");

    const errorCodes = [...new Set([...rep.errors, ...findings])];
    const correct = dtwDeg <= threshold && errorCodes.length === 0;
    st.repCount += 1;
    if (correct) st.correctReps += 1;
    st.peaks.push(rep.peak);
    st.distances.push(dtwDeg);
    st.scores.push(matchScore);
    st.lastRep = { repNumber: st.repCount, dtwDeg, matchScore, tempo: round1(tempo), correct, findings };

    events.push({ type: "REP_COMPLETED", t, repNumber: st.repCount, correct, errors: errorCodes, peakAngle: round1(rep.peak), durationMs, dtwDeg, matchScore });
    // Explain a repetition that was off but had no live correction (e.g. tempo or overall shape).
    const explain = findings.find((c) => !rep.errors.has(c));
    if (explain) events.push({ type: "REP_FEEDBACK", t, repNumber: st.repCount, code: explain, message: ERROR_CATALOG[explain].message });
  }

  return {
    analyzerKey: ANALYZER_KEY,
    config: cfg,
    requiredLandmarks: required,
    errorCatalog: ERROR_CATALOG,
    update,
    summaryMetrics() {
      return {
        referenceReps: ref.reps.length,
        referenceJoint: primary,
        peakPrimaryDeg: st.peaks.length ? round1(dir > 0 ? Math.max(...st.peaks) : Math.min(...st.peaks)) : null,
        meanPeakPrimaryDeg: st.peaks.length ? round1(mean(st.peaks)) : null,
        meanDtwDeg: st.distances.length ? round1(mean(st.distances)) : null,
        meanMatchScore: st.scores.length ? Math.round(mean(st.scores)) : null,
        dtwThresholdDeg: threshold,
        incompleteReps: st.incompleteReps,
      };
    },
  };
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const round1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);
const fmtDeg = (x) => (Number.isFinite(x) ? `${Math.round(x)}°` : "—");
