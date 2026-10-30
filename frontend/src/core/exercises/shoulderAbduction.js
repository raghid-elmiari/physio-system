// Standing bilateral shoulder abduction ("Shoulder Raise"), frontal camera view.
//
// IMPORTANT: the thresholds below are an engineering starting point, NOT clinically
// validated values. A physiotherapist must calibrate them for the intended protocol and
// patient population; the backend can override any of them per exercise via
// exercises.analysis_config_json (merged over DEFAULT_CONFIG).
//
// Movement model
//   SETUP     waiting for the patient to stand still with arms relaxed at the sides
//   REST      starting position (arms down)            -> a repetition begins on leaving it
//   RAISING   arms moving up towards shoulder height
//   HOLDING   both arms at/above target; must stay there for holdMs
//   LOWERING  arms returning to the sides             -> the repetition ends on reaching REST
//
// A repetition is COUNTED only if both arms reached targetAngle AND were held for holdMs,
// then returned to REST. It is counted as CORRECT only if no movement error was active at
// any point during that repetition.

import { assessTracking } from "../analysis/tracking.js";
import { ErrorDetector } from "../analysis/ErrorDetector.js";
import { Ema, RateEstimator, angleBetween, angleFromVertical2d, jointAngle, mid, sub, toAspect } from "../pose/geometry.js";
import { LANDMARK as L } from "../pose/landmarks.js";

export const ANALYZER_KEY = "shoulder_abduction_bilateral";

export const DEFAULT_CONFIG = Object.freeze({
  view: "FRONT",
  minVisibility: 0.6, // MediaPipe visibility below this = landmark not trusted
  restMaxAngle: 30, // arm-to-trunk angle (deg) below which the arm counts as "down"
  targetAngle: 80, // both arms must reach this to count as shoulder height
  maxAngle: 115, // above this the patient is raising higher than prescribed
  holdMs: 1000, // time at target required for a counted repetition
  minElbowAngle: 150, // elbows must stay straighter than this while the arms are up
  maxTrunkLeanDeg: 10, // lateral trunk lean tolerance (compensation)
  maxAsymmetryDeg: 20, // max difference between arms while raising
  maxAngularSpeedDegPerSec: 200, // faster than this = uncontrolled movement
  shrugRatio: 0.7, // ear-to-shoulder distance below 70% of resting value = shoulder hiking
  errorPersistMs: 400, // an error must persist this long before it is reported
  trackingGraceMs: 600, // brief landmark dropouts shorter than this are ignored
  abandonRepAfterMs: 2000, // a repetition in progress is discarded after this long without tracking
  startHoldMs: 500, // arms must rest this long before the first repetition starts
  plateauMs: 1200, // stalling below target this long triggers "lift higher"
});

export const PHASE_LABELS = Object.freeze({
  SETUP: "Get into position",
  REST: "Starting position",
  RAISING: "Raising",
  HOLDING: "Holding",
  LOWERING: "Lowering",
});

const REQUIRED = [L.left_shoulder, L.right_shoulder, L.left_elbow, L.right_elbow, L.left_wrist, L.right_wrist, L.left_hip, L.right_hip];
const OPTIONAL_EARS = [L.left_ear, L.right_ear];

// Higher priority = spoken first when several errors are active at once.
export const ERROR_CATALOG = Object.freeze({
  NOT_AT_START: {
    priority: 90,
    persistMs: 1500,
    message: "Return to the starting position, with your arms relaxed at your sides.",
    landmarks: [L.left_wrist, L.right_wrist],
  },
  TRUNK_LEAN: {
    priority: 85,
    message: "Keep your back straight. Don't lean to the side.",
    landmarks: [L.left_shoulder, L.right_shoulder, L.left_hip, L.right_hip],
  },
  ELBOW_BENT: {
    priority: 75,
    message: "Keep your elbows straight.",
    landmarks: [L.left_elbow, L.right_elbow],
  },
  ARMS_TOO_HIGH: {
    priority: 70,
    message: "Stop at shoulder height.",
    landmarks: [L.left_elbow, L.right_elbow, L.left_wrist, L.right_wrist],
  },
  MOVING_TOO_FAST: {
    priority: 65,
    persistMs: 100,
    message: "Slow down and control the movement.",
    landmarks: [L.left_wrist, L.right_wrist],
  },
  SHOULDERS_HIKED: {
    priority: 60,
    message: "Relax your shoulders down, away from your ears.",
    landmarks: [L.left_shoulder, L.right_shoulder],
  },
  UNEVEN_ARMS: {
    priority: 55,
    message: "Raise both arms evenly.",
    landmarks: [L.left_elbow, L.right_elbow],
  },
  RANGE_TOO_LOW: {
    priority: 50,
    persistMs: 0, // already debounced by the plateau timer
    message: "Lift your arms a little higher, up to shoulder height.",
    landmarks: [L.left_elbow, L.right_elbow],
  },
});

export const INCOMPLETE_MESSAGES = Object.freeze({
  RANGE_TOO_LOW: "Lift your arms a little higher, up to shoulder height.",
  HOLD_TOO_SHORT: "Hold at shoulder height for a moment before lowering.",
});

function trackingMessage(tracking) {
  if (tracking.reason === "NO_PERSON") return "Stand in front of the camera so I can see you.";
  const missing = new Set(tracking.missing);
  if (missing.has(L.left_hip) || missing.has(L.right_hip)) return "Step back so your hips are visible.";
  if (missing.has(L.left_wrist) || missing.has(L.right_wrist) || missing.has(L.left_elbow) || missing.has(L.right_elbow)) {
    return "Make sure both arms are fully visible in the frame.";
  }
  return "Move so your upper body is fully visible.";
}

/**
 * @param {object} [overrides] per-exercise config from the backend (analysisConfig)
 * @param {{targetReps?: number}} [options]
 */
export function createEvaluator(overrides = {}, { targetReps = 10 } = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...(overrides || {}) };
  const errors = new ErrorDetector(ERROR_CATALOG, { persistMs: cfg.errorPersistMs });

  const smooth = { left: new Ema(0.5), right: new Ema(0.5), elbowL: new Ema(0.5), elbowR: new Ema(0.5), lean: new Ema(0.4) };
  const rate = new RateEstimator(200);

  const st = {
    phase: "SETUP",
    setupSince: null,
    restSince: null,
    trackingLost: true,
    everTracked: false,
    lastTrackedT: null,
    rep: null,
    repCount: 0,
    correctReps: 0,
    incompleteReps: 0,
    setCompleteAnnounced: false,
    earBaseline: null,
    peakAngles: [],
  };

  function newRep(t, m) {
    return { start: t, peak: m, reachedTarget: false, holdStart: null, holdAchieved: false, errors: new Set(), plateauSince: null };
  }

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

  function features(frame) {
    const w = frame.width || 1;
    const h = frame.height || 1;
    const p = (i) => toAspect(frame.landmarks[i], w, h);
    // Arm elevation in the frontal (image) plane: angle between the upper arm and the trunk
    // midline (mid-shoulder -> mid-hip), the clinical reference axis for abduction.
    const trunkDown = sub(mid(p(L.left_hip), p(L.right_hip)), mid(p(L.left_shoulder), p(L.right_shoulder)));
    const left = angleBetween(sub(p(L.left_elbow), p(L.left_shoulder)), trunkDown);
    const right = angleBetween(sub(p(L.right_elbow), p(L.right_shoulder)), trunkDown);
    // Elbow flexion can happen in depth, so prefer metric 3D world landmarks when present.
    const W = frame.worldLandmarks && frame.worldLandmarks.length ? frame.worldLandmarks : null;
    const q = W ? (i) => W[i] : p;
    const elbowL = jointAngle(q(L.left_shoulder), q(L.left_elbow), q(L.left_wrist));
    const elbowR = jointAngle(q(L.right_shoulder), q(L.right_elbow), q(L.right_wrist));
    const shoulderMid = mid(p(L.left_shoulder), p(L.right_shoulder));
    const hipMid = mid(p(L.left_hip), p(L.right_hip));
    const lean = angleFromVertical2d(hipMid, shoulderMid);
    const shoulderWidth = Math.hypot(p(L.left_shoulder).x - p(L.right_shoulder).x, p(L.left_shoulder).y - p(L.right_shoulder).y);

    let earDist = null;
    const earsVisible = OPTIONAL_EARS.every((i) => (frame.landmarks[i]?.visibility ?? 0) >= cfg.minVisibility);
    if (earsVisible && shoulderWidth > 0) {
      const dl = p(L.left_shoulder).y - p(L.left_ear).y;
      const dr = p(L.right_shoulder).y - p(L.right_ear).y;
      earDist = (dl + dr) / 2 / shoulderWidth;
    }
    return { left, right, elbowL, elbowR, lean, earDist };
  }

  function update(frame) {
    const t = frame.t;
    const events = [];
    const tracking = assessTracking(frame.landmarks, REQUIRED, { minVisibility: cfg.minVisibility });

    if (!tracking.trackable) {
      const sinceTracked = st.lastTrackedT == null ? Infinity : t - st.lastTrackedT;
      if (!st.trackingLost && sinceTracked >= cfg.trackingGraceMs) {
        st.trackingLost = true;
        errors.clear(); // never keep correcting from stale data
        events.push({ type: "TRACKING_LOST", t, message: trackingMessage(tracking) });
      }
      if (st.trackingLost && st.rep && sinceTracked >= cfg.abandonRepAfterMs) {
        st.rep = null; // cannot judge a repetition we did not see
        st.phase = st.everTracked ? "SETUP" : st.phase;
        st.setupSince = null;
        st.restSince = null;
        events.push({ type: "REP_ABANDONED", t });
      }
      return snapshot(t, {
        trackable: false,
        trackingQuality: tracking.quality,
        trackingIssue: st.trackingLost ? { code: tracking.reason, message: trackingMessage(tracking) } : null,
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

    const f = features(frame);
    const left = smooth.left.update(f.left, t);
    const right = smooth.right.update(f.right, t);
    const elbowL = smooth.elbowL.update(f.elbowL, t);
    const elbowR = smooth.elbowR.update(f.elbowR, t);
    const lean = smooth.lean.update(f.lean, t);
    const m = (left + right) / 2;
    const lo = Math.min(left, right);
    const hi = Math.max(left, right);
    const speed = rate.update(m, t);

    const conditions = [];
    const prevPhase = st.phase;

    // ---- state machine
    switch (st.phase) {
      case "SETUP": {
        st.setupSince ??= t;
        if (m < cfg.restMaxAngle) {
          st.restSince ??= t;
          if (t - st.restSince >= cfg.startHoldMs) {
            st.phase = "REST";
            if (f.earDist != null) st.earBaseline = f.earDist;
            events.push({ type: "READY", t });
          }
        } else {
          st.restSince = null;
          conditions.push({ code: "NOT_AT_START" });
        }
        break;
      }
      case "REST": {
        if (f.earDist != null) st.earBaseline = st.earBaseline == null ? f.earDist : 0.9 * st.earBaseline + 0.1 * f.earDist;
        if (m > cfg.restMaxAngle + 5) {
          st.phase = "RAISING";
          st.rep = newRep(t, m);
        }
        break;
      }
      case "RAISING": {
        const rep = st.rep;
        rep.peak = Math.max(rep.peak, m);
        if (lo >= cfg.targetAngle) {
          st.phase = "HOLDING";
          rep.reachedTarget = true;
          rep.holdStart = t;
          rep.plateauSince = null;
        } else if (m < rep.peak - 15) {
          st.phase = "LOWERING";
        } else if (Math.abs(speed) < 15 && m > cfg.restMaxAngle + 15) {
          rep.plateauSince ??= t;
          if (t - rep.plateauSince >= cfg.plateauMs) conditions.push({ code: "RANGE_TOO_LOW" });
        } else {
          rep.plateauSince = null;
        }
        break;
      }
      case "HOLDING": {
        const rep = st.rep;
        rep.peak = Math.max(rep.peak, m);
        if (lo >= cfg.targetAngle - 5) {
          if (!rep.holdAchieved && t - rep.holdStart >= cfg.holdMs) {
            rep.holdAchieved = true;
            events.push({ type: "HOLD_COMPLETE", t, repNumber: st.repCount + 1 });
          }
        } else {
          st.phase = "LOWERING";
        }
        break;
      }
      case "LOWERING": {
        const rep = st.rep;
        if (!rep.holdAchieved && lo >= cfg.targetAngle) {
          st.phase = "HOLDING";
          rep.reachedTarget = true;
          rep.holdStart = t;
        } else if (m < cfg.restMaxAngle) {
          st.phase = "REST";
          finishRep(t, rep, events);
          st.rep = null;
        }
        break;
      }
      default:
        break;
    }

    // ---- movement-quality conditions (only while the arms are moving / up)
    if (st.phase === "RAISING" || st.phase === "HOLDING" || st.phase === "LOWERING") {
      if (lean > cfg.maxTrunkLeanDeg) conditions.push({ code: "TRUNK_LEAN" });
      if (m > 45) {
        const bentL = elbowL < cfg.minElbowAngle;
        const bentR = elbowR < cfg.minElbowAngle;
        if (bentL || bentR) {
          conditions.push({
            code: "ELBOW_BENT",
            detail: bentL && bentR ? {} : {
              side: bentL ? "left" : "right",
              message: `Straighten your ${bentL ? "left" : "right"} elbow.`,
              landmarks: [bentL ? L.left_elbow : L.right_elbow],
            },
          });
        }
        if (st.earBaseline != null && f.earDist != null && f.earDist < st.earBaseline * cfg.shrugRatio) {
          conditions.push({ code: "SHOULDERS_HIKED" });
        }
      }
      if (hi > cfg.maxAngle) conditions.push({ code: "ARMS_TOO_HIGH" });
      // Also checked in HOLDING: a fast swing usually overshoots into the hold phase.
      if (Math.abs(speed) > cfg.maxAngularSpeedDegPerSec) conditions.push({ code: "MOVING_TOO_FAST" });
      if (m > 40 && Math.abs(left - right) > cfg.maxAsymmetryDeg) {
        const lower = left < right ? "left" : "right";
        const other = lower === "left" ? "right" : "left";
        conditions.push({
          code: "UNEVEN_ARMS",
          detail: {
            side: lower,
            message: `Lift your ${lower} arm a little higher to match your ${other}.`,
            landmarks: [lower === "left" ? L.left_elbow : L.right_elbow],
          },
        });
      }
    }

    const { active, started, resolved } = errors.update(t, conditions);
    for (const e of started) events.push({ type: "ERROR_STARTED", t, code: e.code, message: e.message, priority: e.priority, side: e.detail?.side });
    for (const e of resolved) events.push({ type: "ERROR_RESOLVED", t, code: e.code, durationMs: e.durationMs });
    if (st.rep) for (const e of active) st.rep.errors.add(e.code);
    if (prevPhase !== st.phase) events.push({ type: "PHASE_CHANGED", t, from: prevPhase, to: st.phase });

    if (!st.setCompleteAnnounced && st.repCount >= targetReps) {
      st.setCompleteAnnounced = true;
      events.push({ type: "SET_COMPLETE", t, repCount: st.repCount, correctReps: st.correctReps });
    }

    return snapshot(t, {
      trackable: true,
      trackingQuality: tracking.quality,
      trackingIssue: null,
      status: active.length ? "INCORRECT" : "CORRECT",
      activeErrors: active,
      metrics: {
        leftAbductionDeg: round1(left),
        rightAbductionDeg: round1(right),
        leftElbowDeg: round1(elbowL),
        rightElbowDeg: round1(elbowR),
        trunkLeanDeg: round1(lean),
        angularSpeedDegPerSec: round1(speed),
        progressToTarget: Math.max(0, Math.min(1, lo / cfg.targetAngle)),
      },
      highlight: active.flatMap((e) => e.landmarks),
      events,
    });
  }

  function finishRep(t, rep, events) {
    if (rep.holdAchieved) {
      st.repCount += 1;
      const correct = rep.errors.size === 0;
      if (correct) st.correctReps += 1;
      st.peakAngles.push(rep.peak);
      events.push({
        type: "REP_COMPLETED",
        t,
        repNumber: st.repCount,
        correct,
        errors: [...rep.errors],
        peakAngle: round1(rep.peak),
        durationMs: t - rep.start,
      });
    } else {
      st.incompleteReps += 1;
      const reason = rep.reachedTarget ? "HOLD_TOO_SHORT" : "RANGE_TOO_LOW";
      events.push({ type: "REP_INCOMPLETE", t, reason, message: INCOMPLETE_MESSAGES[reason], peakAngle: round1(rep.peak) });
    }
  }

  return {
    analyzerKey: ANALYZER_KEY,
    config: cfg,
    requiredLandmarks: REQUIRED,
    errorCatalog: ERROR_CATALOG,
    update,
    /** Aggregate metrics for the session summary sent to the backend. */
    summaryMetrics() {
      const peaks = st.peakAngles;
      return {
        peakAbductionDeg: peaks.length ? round1(Math.max(...peaks)) : null,
        meanPeakAbductionDeg: peaks.length ? round1(peaks.reduce((a, b) => a + b, 0) / peaks.length) : null,
        incompleteReps: st.incompleteReps,
      };
    },
  };
}

function round1(x) {
  return Number.isFinite(x) ? Math.round(x * 10) / 10 : null;
}

/** Spoken prompts specific to this exercise (used by the FeedbackController). */
export const VOICE_PROMPTS = Object.freeze({
  intro: "Stand facing the camera with your arms relaxed at your sides.",
  ready: "Good. Now raise both arms out to the side, up to shoulder height.",
  holdComplete: "And lower slowly.",
});

/** Refined wording used when an error persists after the first correction. */
export const REFINED_MESSAGES = Object.freeze({
  TRUNK_LEAN: "Stand tall, with your shoulders level over your hips.",
  ELBOW_BENT: "Make a straight line from your shoulder to your wrist.",
  ARMS_TOO_HIGH: "Bring your arms down a little, level with your shoulders.",
  MOVING_TOO_FAST: "Take about two seconds to raise, and two seconds to lower.",
  SHOULDERS_HIKED: "Let your shoulders drop. Keep your neck long.",
  UNEVEN_ARMS: "Try to keep both hands at the same height.",
  RANGE_TOO_LOW: "A little higher, until your arms are level with your shoulders.",
});
