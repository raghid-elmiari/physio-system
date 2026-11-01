package com.physio.assistant.service;

import com.physio.assistant.entity.ExerciseParameter;
import com.physio.assistant.exception.ApiException;

/**
 * Validation shared by assessments, targets and performance entries.
 *
 * Values outside a parameter's physically possible range ({@code minValid..maxValid}) are
 * rejected; values outside the expected (normal) range are accepted but flagged so a
 * physiotherapist looks at them.
 */
public final class MeasurementRules {

    private MeasurementRules() {}

    /** Result of checking one value: whether to flag it, and why. */
    public record Check(boolean flagged, String reason) {
        static final Check OK = new Check(false, null);
    }

    /**
     * @param value    single value (single-value parameters)
     * @param valueMin range minimum (range parameters)
     * @param valueMax range maximum (range parameters)
     * @param what     "measurement" or "target", used in messages
     */
    public static Check validate(ExerciseParameter p, Double value, Double valueMin, Double valueMax, String what) {
        String name = p.getLabel();
        if (p.isRangeMeasurement()) {
            if (valueMin == null || valueMax == null) {
                throw ApiException.badRequest(name + ": enter both the minimum and the maximum");
            }
            if (value != null) throw ApiException.badRequest(name + ": a range takes a minimum and maximum, not a single value");
            if (valueMin > valueMax) throw ApiException.badRequest(name + ": the minimum cannot be greater than the maximum");
            requirePossible(p, valueMin, what);
            requirePossible(p, valueMax, what);
            if (p.getNormalMax() != null && valueMax > p.getNormalMax()) {
                return new Check(true, "Above the expected range (" + expected(p) + ")");
            }
            if (p.getNormalMin() != null && valueMin < p.getNormalMin()) {
                return new Check(true, "Below the expected range (" + expected(p) + ")");
            }
            return Check.OK;
        }
        if (value == null) throw ApiException.badRequest(name + ": a value is required");
        if (valueMin != null || valueMax != null) throw ApiException.badRequest(name + " takes a single value, not a range");
        requirePossible(p, value, what);
        if (p.getNormalMax() != null && value > p.getNormalMax()) {
            return new Check(true, "Above the expected range (" + expected(p) + ")");
        }
        if (p.getNormalMin() != null && value < p.getNormalMin()) {
            return new Check(true, "Below the expected range (" + expected(p) + ")");
        }
        return Check.OK;
    }

    private static void requirePossible(ExerciseParameter p, double v, String what) {
        if (Double.isNaN(v) || Double.isInfinite(v)) throw ApiException.badRequest(p.getLabel() + ": not a number");
        if ((p.getMinValid() != null && v < p.getMinValid()) || (p.getMaxValid() != null && v > p.getMaxValid())) {
            throw ApiException.badRequest(p.getLabel() + ": " + format(v) + " " + p.getUnit() + " is not a possible "
                    + what + " (allowed " + bound(p.getMinValid()) + " to " + bound(p.getMaxValid()) + " " + p.getUnit() + ")");
        }
    }

    private static String expected(ExerciseParameter p) {
        return bound(p.getNormalMin()) + "–" + bound(p.getNormalMax()) + " " + p.getUnit();
    }

    private static String bound(Double v) {
        return v == null ? "…" : format(v);
    }

    static String format(double v) {
        return v == Math.rint(v) ? String.valueOf((long) v) : String.valueOf(Math.round(v * 10) / 10.0);
    }
}
