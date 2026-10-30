// Small vector helpers for joint-angle features. Points are {x, y, z?}.

const RAD_TO_DEG = 180 / Math.PI;

export function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: (a.z ?? 0) - (b.z ?? 0) };
}

export function mid(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: ((a.z ?? 0) + (b.z ?? 0)) / 2 };
}

export function dot(a, b) {
  return a.x * b.x + a.y * b.y + (a.z ?? 0) * (b.z ?? 0);
}

export function norm(a) {
  return Math.sqrt(dot(a, a));
}

export function distance2d(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Angle in degrees between two vectors (0..180). Returns NaN for zero-length vectors. */
export function angleBetween(u, v) {
  const n = norm(u) * norm(v);
  if (n === 0) return NaN;
  const c = Math.min(1, Math.max(-1, dot(u, v) / n));
  return Math.acos(c) * RAD_TO_DEG;
}

/** Interior angle at joint b formed by a-b-c, in degrees. */
export function jointAngle(a, b, c) {
  return angleBetween(sub(a, b), sub(c, b));
}

/**
 * Angle in degrees between the 2D segment from->to and the image "up" direction (0,-1).
 * Image y grows downward, so an upright trunk (shoulders above hips) gives ~0.
 */
export function angleFromVertical2d(from, to) {
  return angleBetween({ x: to.x - from.x, y: to.y - from.y, z: 0 }, { x: 0, y: -1, z: 0 });
}

/** Normalized image coordinates -> pixel-proportional coordinates (fixes aspect-ratio skew). */
export function toAspect(p, width, height) {
  return { x: p.x * width, y: p.y * height, z: (p.z ?? 0) * width };
}

/** Exponential moving average that tolerates gaps and resets after a long one. */
export class Ema {
  constructor(alpha = 0.5, resetAfterMs = 500) {
    this.alpha = alpha;
    this.resetAfterMs = resetAfterMs;
    this.value = NaN;
    this.t = -Infinity;
  }

  update(x, t) {
    if (!Number.isFinite(x)) return this.value;
    if (!Number.isFinite(this.value) || t - this.t > this.resetAfterMs) this.value = x;
    else this.value = this.alpha * x + (1 - this.alpha) * this.value;
    this.t = t;
    return this.value;
  }

  reset() {
    this.value = NaN;
    this.t = -Infinity;
  }
}

/** Angular speed (deg/s) estimated over a short sliding window to suppress jitter. */
export class RateEstimator {
  constructor(windowMs = 200) {
    this.windowMs = windowMs;
    this.samples = [];
  }

  update(value, t) {
    if (!Number.isFinite(value)) return 0;
    this.samples.push({ value, t });
    while (this.samples.length > 2 && t - this.samples[0].t > this.windowMs) this.samples.shift();
    const first = this.samples[0];
    const dt = (t - first.t) / 1000;
    return dt > 0.05 ? (value - first.value) / dt : 0;
  }

  reset() {
    this.samples = [];
  }
}
