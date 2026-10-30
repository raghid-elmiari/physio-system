// Turns a recorded demonstration (pose frames from a therapist's video) into a reference
// that the reference-matching analyzer compares patients against. Two steps so the UI can
// change choices without re-processing the video:
//   analyzeRecording(frames)            -> joint-angle curves, automatic feature/rep detection
//   buildReference(analysis, choices)   -> compact JSON stored in exercises.analysis_config_json
//
// Only derived joint angles are kept; no frames, images or landmarks are stored.

import { dtw } from "../analysis/dtw.js";
import { FEATURES, FEATURE_KEYS, computeFeatures } from "./features.js";

export const REFERENCE_VERSION = 1;
export const SAMPLE_RATE_HZ = 30;
export const ENVELOPE_BINS = 11; // primary progress 0, 0.1, ..., 1

const DEFAULTS = Object.freeze({
  minVisibility: 0.6,
  minCoverage: 0.8, // a feature must be visible in 80% of the recording to be usable
  minRangeDeg: 15, // a feature that moves less than this is "posture", not "movement"
  maxGapMs: 400, // longer landmark dropouts are not interpolated
  smoothFrames: 5,
  startProgress: 0.25, // a repetition starts when the primary angle passes 25% of its range
  endProgress: 0.15, // ...and ends when it comes back below 15%
  minPeakProgress: 0.7,
  minRepMs: 600,
  maxRepFrames: 300,
  maxReps: 8,
});

/**
 * @param {Array<{t:number, landmarks:Array|null, worldLandmarks?:Array|null, width?:number, height?:number}>} frames
 *   t in ms, increasing (video media time)
 * @param {object} [options] overrides for DEFAULTS, plus {primary?: string, invert?: boolean}
 */
export function analyzeRecording(frames, options = {}) {
  const o = { ...DEFAULTS, ...options };
  if (!frames.length) throw new Error("The recording has no frames.");
  const raw = frames.map((f) => ({ t: f.t, v: computeFeatures(f, { minVisibility: o.minVisibility }) }));
  const t0 = raw[0].t;
  const t1 = raw[raw.length - 1].t;
  const n = Math.max(1, Math.floor(((t1 - t0) * SAMPLE_RATE_HZ) / 1000) + 1);
  const grid = Array.from({ length: n }, (_, i) => t0 + (i * 1000) / SAMPLE_RATE_HZ);

  const series = {};
  const coverage = {};
  const range = {};
  for (const key of FEATURE_KEYS) {
    const pts = raw.filter((r) => r.v[key] != null).map((r) => ({ t: r.t, v: r.v[key] }));
    const values = smooth(sampleOnGrid(pts, grid, o.maxGapMs), o.smoothFrames);
    const valid = values.filter((v) => v != null);
    coverage[key] = valid.length / n;
    if (coverage[key] < o.minCoverage) {
      series[key] = null;
      continue;
    }
    series[key] = fillGaps(values);
    range[key] = percentile(valid, 0.95) - percentile(valid, 0.05);
  }

  const usable = FEATURE_KEYS.filter((k) => series[k]);
  const moving = usable.filter((k) => range[k] >= o.minRangeDeg);
  const movingGroups = new Set(moving.map((k) => FEATURES[k].group));
  // Check the moving joints, the other joints of the same limbs (e.g. keep the elbow straight
  // while the shoulder moves), and trunk posture.
  const defaultSelected = usable.filter((k) => movingGroups.has(FEATURES[k].group) || k === "trunk_lean");
  const primary = options.primary && series[options.primary]
    ? options.primary
    : moving.slice().sort((a, b) => range[b] - range[a])[0] ?? null;

  const analysis = { options: o, durationMs: t1 - t0, sampleRateHz: SAMPLE_RATE_HZ, series, coverage, range, usable, moving, defaultSelected, primary };
  return { ...analysis, ...(primary ? segmentReps(series[primary], { ...o, invert: !!options.invert }) : { reps: [], restValue: null, peakValue: null, progress: [] }) };
}

/**
 * Splits the primary angle curve into repetitions.
 * @returns {{reps: Array<{start:number, end:number, peakIndex:number, durationMs:number}>, restValue:number, peakValue:number, progress:number[]}}
 */
export function segmentReps(values, o = DEFAULTS) {
  const lo = percentile(values, 0.05);
  const hi = percentile(values, 0.95);
  // Most demonstrations start at rest: the end of the range closest to the opening second is "rest".
  const opening = median(values.slice(0, Math.max(3, Math.round(SAMPLE_RATE_HZ * 0.5))));
  let rest = Math.abs(opening - lo) <= Math.abs(opening - hi) ? lo : hi;
  let peak = rest === lo ? hi : lo;
  if (o.invert) [rest, peak] = [peak, rest];
  const span = peak - rest || 1;
  const progress = values.map((v) => (v - rest) / span);

  const reps = [];
  let i = 0;
  while (i < progress.length && reps.length < (o.maxReps ?? DEFAULTS.maxReps)) {
    if (progress[i] <= o.startProgress) {
      i++;
      continue;
    }
    let start = i;
    while (start > 0 && progress[start] >= o.endProgress) start--;
    let j = i;
    let peakIndex = i;
    while (j < progress.length && progress[j] >= o.endProgress) {
      if (progress[j] > progress[peakIndex]) peakIndex = j;
      j++;
    }
    if (j >= progress.length) break; // recording ended mid-repetition
    const durationMs = ((j - start) * 1000) / SAMPLE_RATE_HZ;
    if (progress[peakIndex] >= o.minPeakProgress && durationMs >= o.minRepMs) reps.push({ start, end: j, peakIndex, durationMs });
    i = j + 1;
  }
  return { reps, restValue: rest, peakValue: peak, progress };
}

/**
 * @param {ReturnType<typeof analyzeRecording>} analysis
 * @param {{features?: string[], repIndices?: number[], name?: string}} [choices]
 *   features: which joint angles to compare (primary is always included);
 *   repIndices: which detected repetitions to keep (default: all)
 */
export function buildReference(analysis, choices = {}) {
  const { primary, series } = analysis;
  if (!primary) throw new Error("No moving joint was found in the recording.");
  const chosen = (choices.features ?? analysis.defaultSelected).filter((k) => series[k] && k !== primary);
  const features = [primary, ...chosen];
  const reps = (choices.repIndices ?? analysis.reps.map((_, i) => i)).map((i) => analysis.reps[i]).filter(Boolean);
  if (!reps.length) throw new Error("No complete repetition was found in the recording.");
  const o = analysis.options;

  const repData = reps.map((r) => {
    let frames = [];
    for (let k = r.start; k <= r.end; k++) frames.push(features.map((f) => round1(series[f][k])));
    if (frames.length > o.maxRepFrames) frames = downsample(frames, o.maxRepFrames);
    return { frames, durationMs: Math.round(r.durationMs), peak: round1(series[primary][r.peakIndex]) };
  });

  // Rest: the resting level of the recording (rep boundaries sit at 15% of the range, above it).
  // Peak: the mean peak of the kept repetitions, which is what the patient is asked to reach.
  const restValue = analysis.restValue;
  const peakValue = mean(repData.map((r) => r.peak));
  const span = peakValue - restValue || 1;

  // Expected value of every feature at each stage (progress bin) of the movement, for live checks.
  const sums = features.map(() => new Array(ENVELOPE_BINS).fill(0));
  const counts = new Array(ENVELOPE_BINS).fill(0);
  for (const r of reps) {
    for (let k = r.start; k <= r.end; k++) {
      const p = (series[primary][k] - restValue) / span;
      const bin = Math.max(0, Math.min(ENVELOPE_BINS - 1, Math.round(p * (ENVELOPE_BINS - 1))));
      counts[bin] += 1;
      features.forEach((f, fi) => (sums[fi][bin] += series[f][k]));
    }
  }
  const envelope = {};
  features.forEach((f, fi) => (envelope[f] = fillBins(sums[fi].map((s, b) => (counts[b] ? round1(s / counts[b]) : null)))));

  const speeds = [];
  for (const r of reps) {
    for (let k = r.start + 1; k <= r.end; k++) speeds.push(Math.abs(series[primary][k] - series[primary][k - 1]) * SAMPLE_RATE_HZ);
  }

  // Self-consistency: how far the therapist's own repetitions are from each other.
  let selfDistanceDeg = null;
  if (repData.length >= 2) {
    const d = repData.map((r, i) => Math.min(...repData.filter((_, j) => j !== i).map((q) => dtw(r.frames, q.frames).normalized)));
    selfDistanceDeg = round1(mean(d));
  }
  const dtwThresholdDeg = round1(selfDistanceDeg == null ? 10 : clamp(2 * selfDistanceDeg + 5, 8, 20));

  return {
    version: REFERENCE_VERSION,
    sampleRateHz: SAMPLE_RATE_HZ,
    features,
    primary,
    restValue: round1(restValue),
    peakValue: round1(peakValue),
    reps: repData,
    envelope,
    stats: {
      meanDurationMs: Math.round(mean(repData.map((r) => r.durationMs))),
      maxSpeedDegPerSec: round1(percentile(speeds, 0.95)),
      selfDistanceDeg,
      dtwThresholdDeg,
    },
  };
}

// ---------------------------------------------------------------- helpers

function sampleOnGrid(pts, grid, maxGapMs) {
  const out = new Array(grid.length).fill(null);
  let k = 0;
  for (let i = 0; i < grid.length; i++) {
    const t = grid[i];
    while (k < pts.length - 2 && pts[k + 1].t <= t) k++;
    const a = pts[k];
    const b = pts[Math.min(k + 1, pts.length - 1)];
    if (!a) break;
    if (t <= a.t) out[i] = a.t - t <= maxGapMs / 2 ? a.v : null;
    else if (t >= b.t) out[i] = t - b.t <= maxGapMs / 2 ? b.v : null;
    else out[i] = b.t - a.t <= maxGapMs ? a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t) : null;
  }
  return out;
}

function smooth(values, win) {
  const h = Math.floor(win / 2);
  return values.map((v, i) => {
    if (v == null) return null;
    let s = 0;
    let c = 0;
    for (let j = Math.max(0, i - h); j <= Math.min(values.length - 1, i + h); j++) {
      if (values[j] != null) {
        s += values[j];
        c++;
      }
    }
    return s / c;
  });
}

function fillGaps(values) {
  const out = values.slice();
  let last = null;
  for (let i = 0; i < out.length; i++) {
    if (out[i] != null) {
      if (last != null && i - last > 1) for (let j = last + 1; j < i; j++) out[j] = out[last] + ((out[i] - out[last]) * (j - last)) / (i - last);
      last = i;
    }
  }
  const first = out.findIndex((v) => v != null);
  for (let i = 0; i < first; i++) out[i] = out[first];
  for (let i = (last ?? 0) + 1; i < out.length; i++) out[i] = out[last];
  return out;
}

function fillBins(bins) {
  return bins.map((v, i) => {
    if (v != null) return v;
    for (let d = 1; d < bins.length; d++) {
      if (bins[i - d] != null) return bins[i - d];
      if (bins[i + d] != null) return bins[i + d];
    }
    return null;
  });
}

function downsample(frames, length) {
  return Array.from({ length }, (_, i) => frames[Math.round((i * (frames.length - 1)) / (length - 1))]);
}

export function percentile(values, q) {
  const xs = values.filter((v) => v != null).sort((a, b) => a - b);
  if (!xs.length) return NaN;
  return xs[Math.min(xs.length - 1, Math.max(0, Math.round(q * (xs.length - 1))))];
}

const median = (xs) => percentile(xs, 0.5);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const round1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);
