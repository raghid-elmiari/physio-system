// Draws the skeleton overlay on a <canvas> stacked over the video. The canvas uses the
// video's intrinsic resolution and is mirrored by CSS together with the video, so
// normalized landmark coordinates map directly to canvas pixels.

import { POSE_CONNECTIONS } from "../../core/pose/landmarks.js";

const COLORS = {
  ok: "#22c55e",
  bad: "#ef4444",
  required: "#38bdf8",
  dim: "rgba(255,255,255,0.35)",
};

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<{x:number,y:number,visibility?:number}>|null} landmarks
 * @param {{required?: number[], highlight?: number[], minVisibility?: number, status?: string}} opts
 */
export function drawPose(ctx, landmarks, { required = [], highlight = [], minVisibility = 0.5, status = "CORRECT" } = {}) {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);
  if (!landmarks) return;

  const req = new Set(required);
  const bad = new Set(highlight);
  const visible = (p) => (p?.visibility ?? 1) >= minVisibility;
  const lw = Math.max(2, width / 220);

  ctx.lineCap = "round";
  for (const [a, b] of POSE_CONNECTIONS) {
    const p = landmarks[a];
    const q = landmarks[b];
    if (!visible(p) || !visible(q)) continue;
    const isBad = bad.has(a) && bad.has(b);
    const isReq = req.has(a) && req.has(b);
    ctx.strokeStyle = isBad ? COLORS.bad : isReq ? (status === "UNKNOWN" ? COLORS.required : COLORS.ok) : COLORS.dim;
    ctx.lineWidth = isReq || isBad ? lw * 1.6 : lw;
    ctx.beginPath();
    ctx.moveTo(p.x * width, p.y * height);
    ctx.lineTo(q.x * width, q.y * height);
    ctx.stroke();
  }

  for (let i = 0; i < landmarks.length; i++) {
    const p = landmarks[i];
    if (i > 0 && i < 11) continue; // skip face detail
    const isReq = req.has(i);
    if (!visible(p)) {
      if (isReq && p) {
        // required but unreliable: hollow marker
        ctx.strokeStyle = COLORS.bad;
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.arc(p.x * width, p.y * height, lw * 3, 0, Math.PI * 2);
        ctx.stroke();
      }
      continue;
    }
    ctx.fillStyle = bad.has(i) ? COLORS.bad : isReq ? "#ffffff" : COLORS.dim;
    ctx.beginPath();
    ctx.arc(p.x * width, p.y * height, isReq || bad.has(i) ? lw * 2.4 : lw * 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
}
