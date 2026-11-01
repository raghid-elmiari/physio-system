// Assessment form state <-> API payload, and client-side validation.
import { measurementPayload, validateMeasurements } from "../../lib/measurements";

const orNull = (v) => (v === "" || v == null ? null : v);

/** Editable form state from a stored assessment (patient-reported, not-superseded values). */
export function formStateFromAssessment(a) {
  return {
    notes: a.patientNotes ?? "",
    items: a.items.map((i) => ({
      exerciseId: i.exerciseId,
      painLevel: i.painLevel ?? "",
      difficultyRating: i.difficultyRating ?? "",
      independent: i.independent == null ? "" : String(i.independent),
      limitationNotes: i.limitationNotes ?? "",
      values: Object.fromEntries(i.measurements.filter((m) => !m.superseded).map((m) => [m.parameterId, { value: m.value ?? "", valueMin: m.valueMin ?? "", valueMax: m.valueMax ?? "" }])),
    })),
  };
}

export function assessmentPayload(form, exercises) {
  const byId = new Map(exercises.map((e) => [e.id, e]));
  return {
    patientNotes: form.notes.trim() || null,
    notes: form.notes.trim() || null,
    items: form.items.map((it) => ({
      exerciseId: it.exerciseId,
      painLevel: orNull(it.painLevel),
      difficultyRating: orNull(it.difficultyRating),
      independent: it.independent === "" ? null : it.independent === "true",
      limitationNotes: it.limitationNotes.trim() || null,
      measurements: measurementPayload((byId.get(it.exerciseId)?.parameters || []).filter((p) => p.active && p.assessmentEnabled), it.values),
    })),
  };
}

/** A message describing the first problem, or null. */
export function validateAssessment(form, exercises, { submit }) {
  const byId = new Map(exercises.map((e) => [e.id, e]));
  let measured = 0;
  for (const it of form.items) {
    const ex = byId.get(it.exerciseId);
    const params = (ex?.parameters || []).filter((p) => p.active && p.assessmentEnabled);
    const errors = validateMeasurements(params, it.values);
    const first = Object.entries(errors)[0];
    if (first) return `${ex?.name}: ${params.find((p) => String(p.id) === first[0])?.label} – ${first[1]}`;
    measured += measurementPayload(params, it.values).length;
  }
  if (submit && measured === 0) return "Enter at least one measurement before submitting.";
  return null;
}
