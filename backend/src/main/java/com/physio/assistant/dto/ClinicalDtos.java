package com.physio.assistant.dto;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

/** Assessments, measurements and performance entries. */
public class ClinicalDtos {

    // ------------------------------------------------------------ measurements

    /** One value for one exercise parameter: {@code value} for single values, {@code valueMin}/{@code valueMax} for ranges. */
    public record MeasurementInput(
            @NotNull(message = "parameterId is required") Long parameterId,
            Double value,
            Double valueMin,
            Double valueMax,
            @Size(max = 500) String note
    ) {}

    public record MeasurementResponse(
            Long id, Long parameterId, String code, String label, String unit, String measurementType,
            boolean rangeMeasurement, Double value, Double valueMin, Double valueMax, Double comparableValue,
            String source, String recordedBy, LocalDateTime measuredAt, String note,
            boolean flagged, String flagReason, boolean superseded, Long correctsId,
            Double normalMin, Double normalMax,
            /** For range measurements against an expected range: expected span minus achieved span. */
            Double differenceFromExpected
    ) {}

    // ------------------------------------------------------------ assessments

    public record AssessmentItemInput(
            @NotNull(message = "exerciseId is required") Long exerciseId,
            @Min(0) @Max(10) Integer painLevel,
            @Min(1) @Max(5) Integer difficultyRating,
            Boolean independent,
            @Size(max = 1000) String limitationNotes,
            @Valid @Size(max = 20) List<MeasurementInput> measurements
    ) {}

    /** Saves the patient-reported content of a draft (or revision-requested) assessment. */
    public record SaveAssessmentRequest(
            @Size(max = 2000) String patientNotes,
            @Valid @NotNull @Size(max = 20) List<AssessmentItemInput> items
    ) {}

    public record CreateAssessmentRequest(
            @Pattern(regexp = "INITIAL|FOLLOW_UP", message = "type must be INITIAL or FOLLOW_UP") String type
    ) {}

    /** A physiotherapist records an assessment they measured themselves. */
    public record TherapistAssessmentRequest(
            @NotBlank @Pattern(regexp = "INITIAL|FOLLOW_UP", message = "type must be INITIAL or FOLLOW_UP") String type,
            @Size(max = 2000) String notes,
            @Valid @NotNull @Size(min = 1, max = 20) List<AssessmentItemInput> items
    ) {}

    public record AssessmentItemResponse(
            Long id, Long exerciseId, String exerciseName, Integer painLevel, Integer difficultyRating,
            Boolean independent, String limitationNotes, List<MeasurementResponse> measurements
    ) {}

    public record AssessmentResponse(
            Long id, Long patientId, String patientName, String type, String status,
            String createdBy, Long supersedesId, String patientNotes,
            LocalDateTime submittedAt, String reviewedBy, LocalDateTime reviewedAt, String reviewComment,
            LocalDateTime approvedAt, LocalDateTime createdAt, LocalDateTime updatedAt,
            boolean editable, boolean isBaseline, List<AssessmentItemResponse> items
    ) {}

    public record AssessmentSummary(
            Long id, Long patientId, String patientName, String type, String status,
            LocalDateTime submittedAt, LocalDateTime approvedAt, String reviewedBy, int exerciseCount,
            int flaggedMeasurements, boolean isBaseline, LocalDateTime createdAt
    ) {}

    /** NOT_STARTED when the patient has no assessment at all. */
    public record AssessmentStatusResponse(
            String status, Long currentAssessmentId, Long baselineAssessmentId, String nextType, boolean canStartNew
    ) {}

    public record ReviewCommentRequest(@Size(max = 2000) String comment) {}

    public record RequiredCommentRequest(
            @NotBlank(message = "Explain what needs to change") @Size(max = 2000) String comment
    ) {}

    /** A physiotherapist's correction of (or addition to) a submitted assessment. */
    public record CorrectionRequest(
            Long correctsMeasurementId,
            @NotNull(message = "exerciseId is required") Long exerciseId,
            @NotNull(message = "parameterId is required") Long parameterId,
            Double value,
            Double valueMin,
            Double valueMax,
            @NotBlank(message = "Explain the correction") @Size(max = 500) String note
    ) {}

    public record HistoryEntry(
            Long id, String action, String summary, String actorName, String actorRole, JsonNode details, LocalDateTime createdAt
    ) {}

    // ------------------------------------------------------------ performance

    public record PerformanceRequest(
            @NotNull(message = "assignmentId is required") Long assignmentId,
            LocalDateTime performedAt,
            @Min(0) @Max(50) Integer setsCompleted,
            @Min(0) @Max(1000) Integer repsCompleted,
            @Min(0) @Max(86400) Integer durationSeconds,
            @Min(0) @Max(10) Integer painLevel,
            @Min(1) @Max(5) Integer difficultyRating,
            @Size(max = 1000) String notes,
            @Valid @Size(max = 20) List<MeasurementInput> measurements
    ) {}

    public record FeedbackRequest(
            @NotBlank(message = "Feedback cannot be empty") @Size(max = 2000) String feedback
    ) {}

    public record PerformanceResponse(
            Long id, Long assignmentId, Long exerciseId, String exerciseName, Long sessionId,
            LocalDateTime performedAt, String source, String recordedBy,
            Integer setsCompleted, Integer repsCompleted, Integer durationSeconds,
            Integer painLevel, Integer difficultyRating, String notes,
            boolean flagged, String flagReason,
            /** Computer-vision entries are automated and not clinically validated. */
            boolean automated, JsonNode cvDetails,
            String therapistFeedback, String feedbackBy, LocalDateTime feedbackAt,
            List<MeasurementResponse> measurements, LocalDateTime createdAt
    ) {}

    // ------------------------------------------------------------ progress comparison

    public record ValuePoint(LocalDateTime at, Double value, Double valueMin, Double valueMax, String source, boolean flagged) {}

    /** Baseline vs target vs latest for one parameter of one prescription. */
    public record ParameterProgress(
            Long parameterId, String code, String label, String unit, String measurementType,
            boolean rangeMeasurement, boolean higherIsBetter,
            ValuePoint baseline, Long baselineAssessmentId,
            Double targetValue, Double targetMin, Double targetMax, Double targetComparable,
            ValuePoint latest, Double latestComparable,
            /** target − latest (or − baseline when nothing performed yet), oriented so positive = still to go. */
            Double remaining,
            /** Share of the baseline→target gap closed; null when not meaningful (no/zero baseline, no target, no latest). */
            Double progressPct,
            String progressNote,
            boolean targetReached,
            List<ValuePoint> history
    ) {}

    public record PrescriptionProgress(
            Long assignmentId, Long exerciseId, String exerciseName, String status,
            LocalDate startDate, LocalDate endDate, Integer sessionsPerWeek,
            int entriesInPeriod, Integer expectedEntriesInPeriod, Double completionRatePct,
            Integer latestPain, Double averagePain,
            List<ParameterProgress> parameters, List<String> attention
    ) {}

    public record RehabProgressResponse(
            Long patientId, String patientName, LocalDate periodStart, LocalDate periodEnd,
            Long baselineAssessmentId, LocalDateTime baselineApprovedAt,
            List<PrescriptionProgress> prescriptions,
            int targetsTracked, int targetsReached, Double averageProgressPct,
            List<String> exercisesRequiringAttention,
            /** Which measurement sources contributed, e.g. PATIENT_REPORTED, COMPUTER_VISION. */
            List<String> sources,
            String disclaimer
    ) {}
}
