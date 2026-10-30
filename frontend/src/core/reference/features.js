// Joint-angle features shared by the reference builder (therapist video -> reference) and the
// reference-matching analyzer (live patient -> comparison). Angles, not coordinates, so the
// comparison does not depend on camera distance or body size.
//
// "left"/"right" are the person's sides (MediaPipe convention). Messages describe what the
// patient should change when their value is LOWER or HIGHER than the reference.
// toleranceDeg: default live deviation allowed from the reference at the same movement stage.

import { angleBetween, angleFromVertical2d, jointAngle, mid, sub, toAspect } from "../pose/geometry.js";
import { LANDMARK as L } from "../pose/landmarks.js";

const TRUNK = [L.left_shoulder, L.right_shoulder, L.left_hip, L.right_hip];

function shoulder(side) {
  const s = L[`${side}_shoulder`];
  const e = L[`${side}_elbow`];
  return {
    group: `${side}_arm`,
    label: `${cap(side)} shoulder`,
    toleranceDeg: 25,
    landmarks: [...TRUNK, e],
    highlight: [s, e],
    // Arm elevation relative to the trunk midline (abduction in a front view, flexion in a side view).
    compute: (p) => angleBetween(sub(p(e), p(s)), sub(mid(p(L.left_hip), p(L.right_hip)), mid(p(L.left_shoulder), p(L.right_shoulder)))),
    low: `Raise your ${side} arm higher.`,
    high: `Don't raise your ${side} arm so high.`,
  };
}

function joint(side, name, a, b, c, { low, high, group, world = true, toleranceDeg = 25 }) {
  return {
    group: `${side}_${group}`,
    toleranceDeg,
    label: `${cap(side)} ${name}`,
    landmarks: [a, b, c],
    highlight: [b],
    world,
    compute: (p) => jointAngle(p(a), p(b), p(c)),
    low,
    high,
  };
}

export const FEATURES = Object.freeze({
  left_shoulder: shoulder("left"),
  right_shoulder: shoulder("right"),
  left_elbow: joint("left", "elbow", L.left_shoulder, L.left_elbow, L.left_wrist, {
    group: "arm", low: "Straighten your left elbow.", high: "Bend your left elbow a little more.",
  }),
  right_elbow: joint("right", "elbow", L.right_shoulder, L.right_elbow, L.right_wrist, {
    group: "arm", low: "Straighten your right elbow.", high: "Bend your right elbow a little more.",
  }),
  left_hip: joint("left", "hip", L.left_shoulder, L.left_hip, L.left_knee, {
    group: "leg", low: "Bend less at your left hip.", high: "Bend further at your left hip.",
  }),
  right_hip: joint("right", "hip", L.right_shoulder, L.right_hip, L.right_knee, {
    group: "leg", low: "Bend less at your right hip.", high: "Bend further at your right hip.",
  }),
  left_knee: joint("left", "knee", L.left_hip, L.left_knee, L.left_ankle, {
    group: "leg", low: "Bend your left knee less.", high: "Bend your left knee more.",
  }),
  right_knee: joint("right", "knee", L.right_hip, L.right_knee, L.right_ankle, {
    group: "leg", low: "Bend your right knee less.", high: "Bend your right knee more.",
  }),
  trunk_lean: {
    group: "trunk",
    label: "Trunk lean",
    toleranceDeg: 10, // posture: much less tolerance than a moving joint
    landmarks: TRUNK,
    highlight: TRUNK,
    compute: (p) => angleFromVertical2d(mid(p(L.left_hip), p(L.right_hip)), mid(p(L.left_shoulder), p(L.right_shoulder))),
    low: "Lean your upper body a little more, as shown.",
    high: "Keep your back straight. Don't lean to the side.",
  },
});

export const FEATURE_KEYS = Object.freeze(Object.keys(FEATURES));

/** Error code used when a feature is lower / higher than the reference, e.g. LEFT_ELBOW_LOW. */
export const deviationCode = (key, dir) => `${key.toUpperCase()}_${dir === "low" ? "LOW" : "HIGH"}`;

/**
 * Computes every feature whose landmarks are visible. Missing ones are null.
 * @param {{landmarks:Array|null, worldLandmarks?:Array|null, width?:number, height?:number}} frame
 * @param {{minVisibility?:number, keys?:string[]}} [opts]
 * @returns {Record<string, number|null>}
 */
export function computeFeatures(frame, { minVisibility = 0.6, keys = FEATURE_KEYS } = {}) {
  const out = {};
  const lm = frame.landmarks;
  const w = frame.width || 1;
  const h = frame.height || 1;
  const img = (i) => toAspect(lm[i], w, h);
  const W = frame.worldLandmarks && frame.worldLandmarks.length ? frame.worldLandmarks : null;
  const world = W ? (i) => W[i] : img;
  for (const key of keys) {
    const f = FEATURES[key];
    const visible = !!lm && f.landmarks.every((i) => (lm[i]?.visibility ?? 0) >= minVisibility);
    if (!visible) {
      out[key] = null;
      continue;
    }
    // Joint flexion can happen in depth, so use metric 3D world landmarks when present.
    const v = f.compute(f.world ? world : img);
    out[key] = Number.isFinite(v) ? v : null;
  }
  return out;
}

export function landmarksFor(keys) {
  return [...new Set(keys.flatMap((k) => FEATURES[k].landmarks))];
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
