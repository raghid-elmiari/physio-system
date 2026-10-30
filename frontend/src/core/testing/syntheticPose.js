// Generates synthetic MediaPipe-shaped landmark frames for a person facing the camera.
// Used by the unit tests and by the in-app "simulated input" mode, so the whole
// evaluator -> feedback -> voice pipeline can be exercised without a camera.

import { LANDMARK as L, LANDMARK_COUNT } from "../pose/landmarks.js";

const DEG = Math.PI / 180;

/**
 * @param {object} pose
 * @param {number} pose.leftAbduction  arm-to-trunk angle of the person's left arm (deg)
 * @param {number} pose.rightAbduction
 * @param {number} [pose.leftElbow=178] interior elbow angle (180 = straight)
 * @param {number} [pose.rightElbow=178]
 * @param {number} [pose.trunkLean=0] lateral lean of the upper body (deg)
 * @param {number} [pose.shrug=0] 0..1, how far the shoulders are hiked toward the ears
 * @param {number} [pose.visibility=0.95]
 * @param {number[]} [pose.hidden] landmark indices to report as not visible
 */
export function syntheticFrontPose({
  leftAbduction,
  rightAbduction,
  leftElbow = 178,
  rightElbow = 178,
  trunkLean = 0,
  shrug = 0,
  visibility = 0.95,
  hidden = [],
}) {
  const lm = Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.2 }));
  const set = (i, x, y) => (lm[i] = { x, y, z: 0, visibility });

  const hipY = 0.68;
  const hipL = { x: 0.56, y: hipY };
  const hipR = { x: 0.44, y: hipY };
  const shoulderDrop = shrug * 0.04;
  // Upper body points before lean (person's left = larger x in the un-mirrored image)
  const upper = {
    [L.left_shoulder]: { x: 0.6, y: 0.4 - shoulderDrop },
    [L.right_shoulder]: { x: 0.4, y: 0.4 - shoulderDrop },
    [L.left_ear]: { x: 0.53, y: 0.3 },
    [L.right_ear]: { x: 0.47, y: 0.3 },
    [L.nose]: { x: 0.5, y: 0.31 },
  };
  // Rotate the upper body about the hip centre to simulate lateral lean.
  const pivot = { x: 0.5, y: hipY };
  const rot = (p) => {
    const a = trunkLean * DEG;
    const dx = p.x - pivot.x;
    const dy = p.y - pivot.y;
    return { x: pivot.x + dx * Math.cos(a) - dy * Math.sin(a), y: pivot.y + dx * Math.sin(a) + dy * Math.cos(a) };
  };
  for (const [i, p] of Object.entries(upper)) {
    const r = rot(p);
    set(Number(i), r.x, r.y);
  }
  set(L.left_hip, hipL.x, hipL.y);
  set(L.right_hip, hipR.x, hipR.y);
  set(L.left_knee, 0.56, 0.85);
  set(L.right_knee, 0.44, 0.85);

  const armLen = 0.14;
  const foreLen = 0.13;
  const arm = (shoulderIdx, elbowIdx, wristIdx, abduction, elbowAngle, outward) => {
    const s = lm[shoulderIdx];
    // Downward trunk direction rotated by lean, then rotated outward by the abduction angle.
    const base = Math.PI / 2 + trunkLean * DEG; // pointing down (+y)
    const a = base - outward * abduction * DEG;
    const ex = s.x + armLen * Math.cos(a);
    const ey = s.y + armLen * Math.sin(a);
    set(elbowIdx, ex, ey);
    const bend = (180 - elbowAngle) * DEG;
    const fa = a - outward * bend; // forearm folds upward/inward
    set(wristIdx, ex + foreLen * Math.cos(fa), ey + foreLen * Math.sin(fa));
  };
  arm(L.left_shoulder, L.left_elbow, L.left_wrist, leftAbduction, leftElbow, 1);
  arm(L.right_shoulder, L.right_elbow, L.right_wrist, rightAbduction, rightElbow, -1);

  for (const i of hidden) lm[i] = { ...lm[i], visibility: 0.1 };
  return lm;
}

/**
 * Builds a timeline of frames from keyframes, linearly interpolating every pose field.
 * @param {Array<{at:number} & object>} keyframes times in ms, sorted
 * @param {number} fps
 */
export function interpolateTimeline(keyframes, fps = 30) {
  const frames = [];
  const dt = 1000 / fps;
  const end = keyframes[keyframes.length - 1].at;
  let k = 0;
  for (let t = 0; t <= end + 1e-6; t += dt) {
    while (k < keyframes.length - 2 && t > keyframes[k + 1].at) k++;
    const a = keyframes[k];
    const b = keyframes[Math.min(k + 1, keyframes.length - 1)];
    const span = b.at - a.at;
    const u = span > 0 ? Math.min(1, Math.max(0, (t - a.at) / span)) : 1;
    const pose = {};
    for (const key of Object.keys(a)) {
      if (key === "at") continue;
      if (typeof a[key] === "number" && typeof b[key] === "number") pose[key] = a[key] + (b[key] - a[key]) * u;
      else pose[key] = u < 1 ? a[key] : b[key];
    }
    frames.push({ t, landmarks: syntheticFrontPose(pose), worldLandmarks: null, width: 1, height: 1 });
  }
  return frames;
}

/** One good repetition (rest -> raise -> hold -> lower) starting at `start` ms. */
export function goodRepKeyframes(start, overrides = {}) {
  const base = { leftAbduction: 10, rightAbduction: 10, ...overrides };
  const up = { ...base, leftAbduction: 88, rightAbduction: 88, ...overrides.up };
  return [
    { at: start, ...base },
    { at: start + 1500, ...up },
    { at: start + 2900, ...up },
    { at: start + 4400, ...base },
    { at: start + 5000, ...base },
  ];
}
