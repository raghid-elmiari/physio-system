// Display labels for the clinical vocabulary shared with the backend enums, plus the
// analyzer metrics that can appear in session and patient reports.

export const REHAB_STATUS_LABELS = {
  ASSESSMENT: "Assessment",
  IN_TREATMENT: "In treatment",
  ON_HOLD: "On hold",
  DISCHARGED: "Discharged",
};

export const REHAB_STATUS_TONES = {
  ASSESSMENT: "primary",
  IN_TREATMENT: "success",
  ON_HOLD: "warning",
  DISCHARGED: "",
};

export const PRESCRIPTION_STATUS_LABELS = {
  ACTIVE: "Active",
  PAUSED: "Paused",
  DISCONTINUED: "Discontinued",
  COMPLETED: "Completed",
  REPLACED: "Replaced by a newer version",
};

export const PRESCRIPTION_STATUS_TONES = {
  ACTIVE: "success",
  PAUSED: "warning",
  DISCONTINUED: "danger",
  COMPLETED: "primary",
  REPLACED: "",
};

export const DIFFICULTY_LABELS = { EASY: "Easy", MODERATE: "Moderate", HARD: "Hard" };

/** Analyzer metrics stored with each session (keys written by src/core/exercises/*). */
export const METRIC_LABELS = {
  peakAbductionDeg: ["Highest arm angle", (v) => `${Math.round(v)}°`],
  meanPeakAbductionDeg: ["Average top arm angle", (v) => `${Math.round(v)}°`],
  // Reference-matching exercises (analyzer reference_dtw)
  meanMatchScore: ["Match with reference (avg)", (v) => `${Math.round(v)}%`],
  meanDtwDeg: ["Average difference from reference", (v) => `${Math.round(v * 10) / 10}°`],
  peakPrimaryDeg: ["Largest main-joint angle", (v) => `${Math.round(v)}°`],
  meanPeakPrimaryDeg: ["Average main-joint peak", (v) => `${Math.round(v)}°`],
  incompleteReps: ["Attempts not counted", (v) => v],
  trackedFramePct: ["Time fully visible to the camera", (v) => `${Math.round(v)}%`],
  meanTrackingQuality: ["Tracking quality", (v) => `${Math.round(v * 100)}%`],
  meanProcessedFps: ["Analysis rate", (v) => `${v} fps`],
  meanInferenceMs: ["Pose model time", (v) => `${v} ms`],
  voiceLatencyMsMean: ["Detection to speech (avg)", (v) => `${v} ms`],
  voiceLatencyMsP95: ["Detection to speech (p95)", (v) => `${v} ms`],
  voiceEngineLatencyMsMean: ["Speech engine start (avg)", (v) => `${v} ms`],
};

export function metricLabel(key) {
  return METRIC_LABELS[key]?.[0] ?? key;
}

export function formatMetric(key, value) {
  if (value == null) return "—";
  return METRIC_LABELS[key] ? METRIC_LABELS[key][1](value) : String(value);
}

export function formatPercent(value) {
  return value == null ? "—" : `${Math.round(value)}%`;
}

/** "10 reps × 3 sets · 4×/week · 30 s hold · 45 s rest" */
export function describeDose(prescription) {
  const parts = [`${prescription.targetReps} reps × ${prescription.setsPerSession} set${prescription.setsPerSession > 1 ? "s" : ""}`];
  if (prescription.sessionsPerWeek) parts.push(`${prescription.sessionsPerWeek}×/week`);
  if (prescription.durationSeconds) parts.push(`${prescription.durationSeconds} s hold`);
  if (prescription.restSeconds) parts.push(`${prescription.restSeconds} s rest`);
  return parts.join(" · ");
}
