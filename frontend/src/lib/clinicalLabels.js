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
  PENDING_APPROVAL: "Awaiting approval",
  APPROVED: "Approved, starts later",
  ACTIVE: "Active",
  PAUSED: "Paused",
  DISCONTINUED: "Discontinued",
  COMPLETED: "Completed",
  REPLACED: "Replaced by a newer version",
};

export const PRESCRIPTION_STATUS_TONES = {
  PENDING_APPROVAL: "warning",
  APPROVED: "primary",
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

export const ASSESSMENT_STATUS_LABELS = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "Draft",
  SUBMITTED: "Submitted (waiting for a therapist)",
  PENDING_REVIEW: "Waiting for review",
  APPROVED: "Approved",
  REVISION_REQUESTED: "Revision requested",
};

export const ASSESSMENT_STATUS_TONES = {
  NOT_STARTED: "",
  IN_PROGRESS: "",
  SUBMITTED: "primary",
  PENDING_REVIEW: "primary",
  APPROVED: "success",
  REVISION_REQUESTED: "warning",
};

export const ASSESSMENT_TYPE_LABELS = { INITIAL: "Initial (baseline)", FOLLOW_UP: "Follow-up" };

export const VIDEO_STATUS_LABELS = {
  PENDING: "Pending approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  REVISION_REQUESTED: "Revision requested",
};

export const VIDEO_STATUS_TONES = { PENDING: "primary", APPROVED: "success", REJECTED: "danger", REVISION_REQUESTED: "warning" };

export const SOURCE_LABELS = {
  PATIENT_REPORTED: "Patient-reported",
  THERAPIST_MEASURED: "Therapist-measured",
  COMPUTER_VISION: "Computer vision (automated, not validated)",
};

export const SOURCE_SHORT = { PATIENT_REPORTED: "Patient", THERAPIST_MEASURED: "Therapist", COMPUTER_VISION: "Camera (auto)" };

export const SOURCE_TONES = { PATIENT_REPORTED: "", THERAPIST_MEASURED: "primary", COMPUTER_VISION: "warning" };

export const MEASUREMENT_TYPES = {
  ANGLE: { label: "Angle", unit: "deg" },
  FLEXIBILITY: { label: "Flexibility", unit: "cm" },
  REPETITIONS: { label: "Repetitions", unit: "count" },
  DURATION: { label: "Duration", unit: "s" },
  DISTANCE: { label: "Distance", unit: "m" },
  PAIN: { label: "Pain", unit: "0-10" },
  CUSTOM: { label: "Custom", unit: "" },
};

export const ROLE_LABELS = { PATIENT: "Patient", THERAPIST: "Physiotherapist", ADMIN: "Administrator" };

const UNIT_SUFFIX = { deg: "°", count: "", s: " s", cm: " cm", m: " m" };

/** "65°", "12", "30 s" */
export function formatValue(value, unit) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  const n = Math.round(Number(value) * 10) / 10;
  return `${n}${UNIT_SUFFIX[unit] ?? (unit ? ` ${unit}` : "")}`;
}

/** A measured value or range: "0°–65°" or "12". Accepts measurement or target-like objects. */
export function formatMeasured(m, unit = m?.unit) {
  if (!m) return "—";
  const value = m.value ?? m.targetValue;
  const min = m.valueMin ?? m.targetMin;
  const max = m.valueMax ?? m.targetMax;
  if (value != null) return formatValue(value, unit);
  if (min != null || max != null) return `${formatValue(min, unit)}–${formatValue(max, unit)}`;
  return "—";
}

/** "Expected 0°–120°" for a parameter with a normal range. */
export function formatExpected(p, unit = p?.unit) {
  if (p?.normalMin == null && p?.normalMax == null) return null;
  return `${p.normalMin != null ? formatValue(p.normalMin, unit) : "…"}–${p.normalMax != null ? formatValue(p.normalMax, unit) : "…"}`;
}
