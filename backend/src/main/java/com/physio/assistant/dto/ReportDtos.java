package com.physio.assistant.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * Patient performance and rehabilitation reports.
 *
 * {@link PatientMeasurements} contains only system-generated figures computed from the
 * sessions the on-device computer-vision coach recorded. It never contains clinical
 * judgement; the physiotherapist's assessment is carried separately in {@link ReportResponse}.
 */
public class ReportDtos {

    public record PatientMeasurements(
            PatientInfo patient,
            Period period,
            Totals totals,
            List<PrescriptionAdherence> prescriptions,
            List<ExercisePerformance> exercises,
            PeriodComparison previousPeriod,
            List<SessionPerformance> sessions,
            AutomatedFindings automatedFindings,
            LocalDateTime generatedAt,
            /** Baseline vs target vs actual (frozen in reports generated since the clinical workflow; null in older ones). */
            com.physio.assistant.dto.ClinicalDtos.RehabProgressResponse rehabProgress
    ) {
        public PatientMeasurements withRehabProgress(com.physio.assistant.dto.ClinicalDtos.RehabProgressResponse progress) {
            return new PatientMeasurements(patient, period, totals, prescriptions, exercises, previousPeriod, sessions,
                    automatedFindings, generatedAt, progress);
        }
    }

    public record PatientInfo(Long id, String name, String email, LocalDate dateOfBirth, String primaryCondition) {}

    public record Period(LocalDate from, LocalDate to, int days) {}

    /**
     * @param expectedSessions estimated from each prescription's weekly frequency over the days it was in force
     * @param missedSessions expected minus completed, per prescription, never below zero
     * @param movementErrorsDetected number of times the coach flagged a persistent movement error
     */
    public record Totals(
            int sessionsStarted, int completedSessions, int interruptedSessions,
            int totalReps, int correctReps, int totalDurationSeconds, Double averageAccuracyPct,
            int expectedSessions, int missedSessions, Double completionPct, int movementErrorsDetected
    ) {}

    public record PrescriptionAdherence(
            Long assignmentId, String exerciseName, String status,
            Integer targetReps, Integer setsPerSession, Integer sessionsPerWeek,
            Integer durationSeconds, Integer restSeconds, LocalDate startDate, LocalDate endDate,
            String difficulty, String instructions,
            int expectedSessions, int completedSessions, Double completionPct
    ) {}

    /**
     * @param averageMeasurements averages of the joint-angle / matching metrics the analyzer
     *                            reported for this exercise (keys as stored in the session report)
     */
    public record ExercisePerformance(
            Long exerciseId, String exerciseName,
            int completedSessions, int interruptedSessions, int totalReps, int correctReps,
            int totalDurationSeconds, Double averageAccuracyPct,
            Double firstAccuracyPct, Double latestAccuracyPct, Double accuracyChangePts,
            int movementErrorsDetected, List<ErrorCount> commonErrors,
            Map<String, Double> averageMeasurements
    ) {}

    public record ErrorCount(String code, String message, int count) {}

    public record PeriodComparison(LocalDate from, LocalDate to, int completedSessions, int totalReps, Double averageAccuracyPct) {}

    public record SessionPerformance(
            Long sessionId, LocalDateTime startedAt, Long exerciseId, String exerciseName, String status,
            Integer repsCompleted, Integer repsRequested, Integer correctReps, Double accuracyPct,
            Integer durationSeconds, int movementErrorsDetected, Long assignmentId
    ) {}

    /** Rule-based flags derived from the figures above; shown labelled as automated, never as a diagnosis. */
    public record AutomatedFindings(List<String> improvements, List<String> needsAttention, String disclaimer) {}

    // ------------------------------------------------------------------ stored reports

    public record CreateReportRequest(
            @NotNull(message = "from is required") LocalDate from,
            @NotNull(message = "to is required") LocalDate to,
            @Size(max = 200) String title
    ) {}

    public record UpdateReportRequest(
            @Size(max = 200) String title,
            @Size(max = 4000) String observations,
            @Size(max = 4000) String recommendations,
            @Size(max = 4000) String exerciseModifications,
            @Size(max = 4000) String followUpInstructions,
            Boolean sharedWithPatient
    ) {}

    public record ReportSummary(
            Long id, Long patientId, String title, LocalDate periodStart, LocalDate periodEnd,
            String authorName, boolean sharedWithPatient, LocalDateTime createdAt, LocalDateTime updatedAt
    ) {}

    public record ReportResponse(
            Long id, Long patientId, String title, LocalDate periodStart, LocalDate periodEnd,
            String authorName, boolean sharedWithPatient, LocalDateTime createdAt, LocalDateTime updatedAt,
            PatientMeasurements measurements,
            ProfessionalAssessment assessment
    ) {}

    /** Written by the physiotherapist; kept apart from the system-generated measurements. */
    public record ProfessionalAssessment(
            String observations, String recommendations, String exerciseModifications, String followUpInstructions
    ) {}
}
