// Decides whether a frame can be evaluated at all. Corrections must never be produced from
// landmarks MediaPipe is not confident about, or from body parts outside the camera frame.

const EDGE_MARGIN = 0.01;

/**
 * @param {Array<{x:number,y:number,visibility?:number}>|null} landmarks normalized image landmarks
 * @param {number[]} required landmark indices the exercise needs
 * @param {{minVisibility:number, names?: Record<number,string>}} opts
 * @returns {{trackable:boolean, quality:number, missing:number[], reason:string|null}}
 */
export function assessTracking(landmarks, required, { minVisibility }) {
  if (!landmarks || landmarks.length === 0) {
    return { trackable: false, quality: 0, missing: required.slice(), reason: "NO_PERSON" };
  }
  const missing = [];
  let sum = 0;
  for (const i of required) {
    const p = landmarks[i];
    const vis = p?.visibility ?? 0;
    const inFrame = p && p.x >= -EDGE_MARGIN && p.x <= 1 + EDGE_MARGIN && p.y >= -EDGE_MARGIN && p.y <= 1 + EDGE_MARGIN;
    sum += inFrame ? vis : 0;
    if (!inFrame || vis < minVisibility) missing.push(i);
  }
  const quality = required.length ? sum / required.length : 0;
  return {
    trackable: missing.length === 0,
    quality,
    missing,
    reason: missing.length === 0 ? null : "LANDMARKS_NOT_VISIBLE",
  };
}
