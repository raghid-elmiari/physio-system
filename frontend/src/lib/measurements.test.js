import { describe, expect, it } from "vitest";
import { measurementPayload, validateMeasurements } from "./measurements";
import { formatMeasured } from "./clinicalLabels";

const rom = { id: 1, label: "Knee flexion", unit: "deg", rangeMeasurement: true, minValid: -20, maxValid: 180 };
const reps = { id: 2, label: "Reps", unit: "count", rangeMeasurement: false, minValid: 0, maxValid: 500 };

describe("measurement helpers", () => {
  it("validates ranges and limits like the backend", () => {
    expect(validateMeasurements([rom, reps], { 1: { valueMin: 0, valueMax: 65 }, 2: { value: 3 } })).toEqual({});
    expect(validateMeasurements([rom], { 1: { valueMin: 70, valueMax: 20 } })[1]).toMatch(/greater/);
    expect(validateMeasurements([rom], { 1: { valueMin: 0, valueMax: 400 } })[1]).toMatch(/between/);
    expect(validateMeasurements([rom], { 1: { valueMin: 0, valueMax: "" } })[1]).toMatch(/both/);
    expect(validateMeasurements([reps], {})).toEqual({});
    expect(validateMeasurements([reps], {}, { requireAll: true })[2]).toBe("Required");
  });

  it("sends only filled-in values in the API shape", () => {
    expect(measurementPayload([rom, reps], { 1: { valueMin: 0, valueMax: 65 }, 2: { value: "" } }))
      .toEqual([{ parameterId: 1, valueMin: 0, valueMax: 65 }]);
  });

  it("formats values and ranges with units", () => {
    expect(formatMeasured({ valueMin: 0, valueMax: 65, unit: "deg" })).toBe("0°–65°");
    expect(formatMeasured({ value: 12, unit: "count" })).toBe("12");
    expect(formatMeasured({ targetValue: 30 }, "s")).toBe("30 s");
    expect(formatMeasured(null)).toBe("—");
  });
});
