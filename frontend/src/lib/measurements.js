// Measurement form helpers shared by assessment, target and performance forms.

/** Client-side checks mirroring the backend rules; returns { [parameterId]: message }. */
export function validateMeasurements(parameters, values, { requireAll = false } = {}) {
  const errors = {};
  for (const p of parameters || []) {
    const v = values[p.id] || {};
    const present = (n) => n !== "" && n != null;
    const filled = p.rangeMeasurement ? (present(v.valueMin) || present(v.valueMax)) : present(v.value);
    if (!filled) {
      if (requireAll) errors[p.id] = "Required";
      continue;
    }
    const nums = p.rangeMeasurement ? [v.valueMin, v.valueMax] : [v.value];
    if (nums.some((n) => n === "" || n == null || Number.isNaN(Number(n)))) { errors[p.id] = p.rangeMeasurement ? "Enter both minimum and maximum" : "Enter a number"; continue; }
    if (nums.some((n) => (p.minValid != null && n < p.minValid) || (p.maxValid != null && n > p.maxValid))) {
      errors[p.id] = `Must be between ${p.minValid ?? "…"} and ${p.maxValid ?? "…"} ${p.unit}`; continue;
    }
    if (p.rangeMeasurement && v.valueMin > v.valueMax) errors[p.id] = "Minimum is greater than maximum";
  }
  return errors;
}

/** API payload for the filled-in parameters only. */
export function measurementPayload(parameters, values) {
  const out = [];
  for (const p of parameters || []) {
    const v = values[p.id] || {};
    if (p.rangeMeasurement) {
      if (v.valueMin === "" || v.valueMin == null || v.valueMax === "" || v.valueMax == null) continue;
      out.push({ parameterId: p.id, valueMin: v.valueMin, valueMax: v.valueMax });
    } else if (v.value !== "" && v.value != null) {
      out.push({ parameterId: p.id, value: v.value });
    }
  }
  return out;
}


/**
 * Performance forms ask for repetitions once (a dedicated field). The exercise's REPETITIONS
 * parameter, if any, is filled from that field instead of being asked for twice.
 */
export function splitRepetitionParameter(parameters) {
  const reps = (parameters || []).find((p) => p.measurementType === "REPETITIONS" && !p.rangeMeasurement);
  return { repsParameter: reps ?? null, otherParameters: (parameters || []).filter((p) => p !== reps) };
}

export function withRepetitions(measurements, repsParameter, repsCompleted) {
  if (!repsParameter || repsCompleted === "" || repsCompleted == null) return measurements;
  return [...measurements, { parameterId: repsParameter.id, value: repsCompleted }];
}
