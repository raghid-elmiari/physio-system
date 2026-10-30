// Dynamic Time Warping between two multi-feature series (e.g. joint-angle curves of one
// repetition). Used to compare a patient's repetition with a therapist's reference
// repetition independently of speed: DTW aligns the two in time before measuring distance.
//
// Series are arrays of frames; each frame is an array of numbers (one per feature, same order
// in both series, in degrees). The frame distance is the mean absolute difference over the
// features, so `normalized` (total cost / path length) reads as "average degrees off".

/**
 * @param {number[][]} a
 * @param {number[][]} b
 * @param {{band?: number}} [opts] band: Sakoe-Chiba window as a fraction of the longer series
 *   (0.2 = a frame may be matched at most 20% of the repetition away). Always widened to at
 *   least |a.length - b.length| so the two ends can still be aligned.
 * @returns {{distance:number, normalized:number, path:Array<[number, number]>}}
 */
export function dtw(a, b, { band = 0.2 } = {}) {
  const n = a.length;
  const m = b.length;
  if (!n || !m) return { distance: Infinity, normalized: Infinity, path: [] };
  const w = Math.max(Math.abs(n - m), Math.ceil(band * Math.max(n, m)));

  // Full cost matrix is fine at repetition sizes (~50-300 frames each).
  const cost = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(Infinity));
  cost[0][0] = 0;
  for (let i = 1; i <= n; i++) {
    // Window centred on the diagonal scaled to the two lengths.
    const centre = Math.round((i * m) / n);
    const jFrom = Math.max(1, centre - w);
    const jTo = Math.min(m, centre + w);
    for (let j = jFrom; j <= jTo; j++) {
      const d = frameDistance(a[i - 1], b[j - 1]);
      cost[i][j] = d + Math.min(cost[i - 1][j], cost[i][j - 1], cost[i - 1][j - 1]);
    }
  }
  if (!Number.isFinite(cost[n][m])) return { distance: Infinity, normalized: Infinity, path: [] };

  const path = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    path.push([i - 1, j - 1]);
    const diag = cost[i - 1][j - 1];
    const up = cost[i - 1][j];
    const left = cost[i][j - 1];
    if (diag <= up && diag <= left) {
      i--;
      j--;
    } else if (up < left) {
      i--;
    } else {
      j--;
    }
  }
  path.reverse();
  return { distance: cost[n][m], normalized: cost[n][m] / path.length, path };
}

export function frameDistance(x, y) {
  let s = 0;
  for (let k = 0; k < x.length; k++) s += Math.abs(x[k] - y[k]);
  return x.length ? s / x.length : 0;
}

/**
 * Per-feature mean signed difference (a - b) along a DTW path: tells which joint was off
 * and in which direction once the two repetitions are aligned in time.
 * @returns {number[]}
 */
export function featureDeviations(a, b, path) {
  const k = a[0]?.length ?? 0;
  const sums = new Array(k).fill(0);
  for (const [i, j] of path) for (let f = 0; f < k; f++) sums[f] += a[i][f] - b[j][f];
  return sums.map((s) => (path.length ? s / path.length : 0));
}

/**
 * Linear resampling of a series to `length` frames (keeps DTW cost bounded for long reps).
 * @param {number[][]} series
 * @param {number} length
 */
export function resample(series, length) {
  if (series.length === length || series.length < 2) return series.slice();
  const out = [];
  for (let i = 0; i < length; i++) {
    const pos = (i * (series.length - 1)) / (length - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(series.length - 1, lo + 1);
    const u = pos - lo;
    out.push(series[lo].map((v, f) => v + (series[hi][f] - v) * u));
  }
  return out;
}
