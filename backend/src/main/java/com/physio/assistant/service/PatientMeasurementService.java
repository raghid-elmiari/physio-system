package com.physio.assistant.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.physio.assistant.dto.ReportDtos.*;
import com.physio.assistant.entity.ExerciseAssignment;
import com.physio.assistant.entity.Session;
import com.physio.assistant.entity.SessionReport;
import com.physio.assistant.entity.User;
import com.physio.assistant.exception.ApiException;
import com.physio.assistant.repository.ExerciseAssignmentRepository;
import com.physio.assistant.repository.SessionReportRepository;
import com.physio.assistant.repository.SessionRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Turns the sessions recorded by the on-device computer-vision coach into performance
 * figures for one patient and date range.
 *
 * Only data the system actually records is used: repetitions counted, repetitions without a
 * persistent movement error ("correct"), duration, the movement errors flagged by the coach
 * and the joint-angle metrics the analyzer stored. Sets are not tracked by the camera
 * analysis, so no completed-set figure is produced. Expected sessions are an estimate from
 * the prescribed weekly frequency and are labelled as such.
 */
@Service
public class PatientMeasurementService {

    static final int MAX_REPORT_DAYS = 366;
    private static final double LOW_ACCURACY_PCT = 60.0;
    private static final double LOW_COMPLETION_PCT = 50.0;
    private static final double MEANINGFUL_IMPROVEMENT_PTS = 10.0;
    private static final int RECURRING_ERROR_COUNT = 5;

    /** Analyzer metrics worth averaging per exercise (keys written by the frontend analyzers). */
    private static final List<String> AVERAGED_METRICS = List.of(
            "meanPeakAbductionDeg", "peakAbductionDeg", "meanPeakPrimaryDeg", "peakPrimaryDeg",
            "meanMatchScore", "meanDtwDeg", "trackedFramePct");

    static final String FINDINGS_DISCLAIMER = "Automated flags computed from the recorded sessions. "
            + "They are not a clinical assessment and must be reviewed by the physiotherapist.";

    private final SessionRepository sessionRepository;
    private final SessionReportRepository sessionReportRepository;
    private final ExerciseAssignmentRepository assignmentRepository;
    private final ObjectMapper objectMapper;

    public PatientMeasurementService(SessionRepository sessionRepository, SessionReportRepository sessionReportRepository,
                                     ExerciseAssignmentRepository assignmentRepository, ObjectMapper objectMapper) {
        this.sessionRepository = sessionRepository;
        this.sessionReportRepository = sessionReportRepository;
        this.assignmentRepository = assignmentRepository;
        this.objectMapper = objectMapper;
    }

    @Transactional(readOnly = true)
    public PatientMeasurements measure(User patient, LocalDate from, LocalDate to) {
        validatePeriod(from, to);
        List<Session> sessions = sessionsBetween(patient.getId(), from, to);
        Map<Long, SessionReport> reportsBySession = reportsFor(sessions);
        List<ExerciseAssignment> prescriptions = assignmentRepository.findByPatientIdOrderByCreatedAtDesc(patient.getId());

        List<PrescriptionAdherence> adherence = prescriptions.stream()
                .map(p -> adherenceFor(p, sessions, from, to))
                .filter(Objects::nonNull)
                .toList();
        List<ExercisePerformance> exercises = performanceByExercise(sessions, reportsBySession);
        Totals totals = totals(sessions, reportsBySession, adherence);

        return new PatientMeasurements(
                new PatientInfo(patient.getId(), patient.getFullName(), patient.getEmail(),
                        patient.getDateOfBirth(), patient.getPrimaryCondition()),
                new Period(from, to, (int) ChronoUnit.DAYS.between(from, to) + 1),
                totals, adherence, exercises,
                previousPeriod(patient.getId(), from, to),
                sessions.stream().map(s -> toSessionPerformance(s, reportsBySession.get(s.getId()))).toList(),
                findings(exercises, adherence),
                LocalDateTime.now(),
                null);
    }

    static void validatePeriod(LocalDate from, LocalDate to) {
        if (from == null || to == null) throw ApiException.badRequest("Both from and to dates are required");
        if (to.isBefore(from)) throw ApiException.badRequest("The end date cannot be before the start date");
        if (ChronoUnit.DAYS.between(from, to) >= MAX_REPORT_DAYS) {
            throw ApiException.badRequest("Reports can cover at most " + MAX_REPORT_DAYS + " days");
        }
    }

    // ---------------------------------------------------------------- data loading

    private List<Session> sessionsBetween(Long patientId, LocalDate from, LocalDate to) {
        return sessionRepository.findByUserIdAndStartedAtBetweenOrderByStartedAtAsc(
                patientId, from.atStartOfDay(), to.plusDays(1).atStartOfDay().minusNanos(1));
    }

    private Map<Long, SessionReport> reportsFor(List<Session> sessions) {
        List<Long> completedIds = sessions.stream()
                .filter(s -> s.getStatus() == Session.Status.COMPLETED).map(Session::getId).toList();
        if (completedIds.isEmpty()) return Map.of();
        return sessionReportRepository.findBySessionIdIn(completedIds).stream()
                .collect(Collectors.toMap(r -> r.getSession().getId(), Function.identity()));
    }

    // ---------------------------------------------------------------- adherence

    /** Null when the prescription was not in force at any point of the period. */
    private PrescriptionAdherence adherenceFor(ExerciseAssignment prescription, List<Session> sessions,
                                               LocalDate from, LocalDate to) {
        LocalDate inForceFrom = latest(from, prescription.getStartDate(), prescription.getCreatedAt().toLocalDate());
        LocalDate inForceTo = earliest(to, prescription.getEndDate(), LocalDate.now(), stoppedOn(prescription));
        if (inForceTo.isBefore(inForceFrom)) return null;

        long daysInForce = ChronoUnit.DAYS.between(inForceFrom, inForceTo) + 1;
        int expected = prescription.getSessionsPerWeek() == null ? 0
                : (int) Math.round(prescription.getSessionsPerWeek() * daysInForce / 7.0);
        int completed = (int) sessions.stream()
                .filter(s -> s.getStatus() == Session.Status.COMPLETED)
                .filter(s -> s.getAssignment() != null && s.getAssignment().getId().equals(prescription.getId()))
                .count();

        return new PrescriptionAdherence(
                prescription.getId(), prescription.getExercise().getName(), prescription.getStatus().name(),
                prescription.getTargetReps(), prescription.getSetsPerSession(), prescription.getSessionsPerWeek(),
                prescription.getDurationSeconds(), prescription.getRestSeconds(),
                prescription.getStartDate(), prescription.getEndDate(),
                prescription.getDifficulty() == null ? null : prescription.getDifficulty().name(),
                prescription.getNotes(),
                expected, completed, expected == 0 ? null : percent(Math.min(completed, expected), expected));
    }

    /** The day a no-longer-active prescription stopped being in force (its last status change). */
    private static LocalDate stoppedOn(ExerciseAssignment prescription) {
        if (prescription.getStatus() == ExerciseAssignment.Status.ACTIVE) return null;
        LocalDateTime changedAt = prescription.getUpdatedAt() != null ? prescription.getUpdatedAt() : prescription.getCreatedAt();
        return changedAt.toLocalDate();
    }

    // ---------------------------------------------------------------- performance

    private List<ExercisePerformance> performanceByExercise(List<Session> sessions, Map<Long, SessionReport> reports) {
        Map<Long, List<Session>> byExercise = sessions.stream()
                .collect(Collectors.groupingBy(s -> s.getExercise().getId(), LinkedHashMap::new, Collectors.toList()));

        List<ExercisePerformance> result = new ArrayList<>();
        for (List<Session> exerciseSessions : byExercise.values()) {
            List<Session> completed = exerciseSessions.stream().filter(s -> s.getStatus() == Session.Status.COMPLETED).toList();
            List<Double> accuracies = completed.stream().map(s -> accuracyOf(reports.get(s.getId())))
                    .filter(Objects::nonNull).toList();
            Double first = accuracies.isEmpty() ? null : accuracies.get(0);
            Double latest = accuracies.isEmpty() ? null : accuracies.get(accuracies.size() - 1);
            List<ErrorCount> errors = mergeErrors(completed.stream().map(s -> reports.get(s.getId())).toList());

            result.add(new ExercisePerformance(
                    exerciseSessions.get(0).getExercise().getId(), exerciseSessions.get(0).getExercise().getName(),
                    completed.size(), exerciseSessions.size() - completed.size(),
                    completed.stream().mapToInt(s -> orZero(s.getRoundsCompleted())).sum(),
                    completed.stream().mapToInt(s -> orZero(s.getCorrectReps())).sum(),
                    completed.stream().mapToInt(s -> orZero(s.getDurationSeconds())).sum(),
                    average(accuracies), first, latest,
                    accuracies.size() >= 2 ? round(latest - first) : null,
                    errors.stream().mapToInt(ErrorCount::count).sum(),
                    errors.stream().limit(5).toList(),
                    averageMetrics(completed.stream().map(s -> reports.get(s.getId())).toList())));
        }
        return result;
    }

    private Totals totals(List<Session> sessions, Map<Long, SessionReport> reports, List<PrescriptionAdherence> adherence) {
        List<Session> completed = sessions.stream().filter(s -> s.getStatus() == Session.Status.COMPLETED).toList();
        int expected = adherence.stream().mapToInt(PrescriptionAdherence::expectedSessions).sum();
        int completedAgainstPlan = adherence.stream()
                .mapToInt(a -> Math.min(a.completedSessions(), a.expectedSessions())).sum();
        int movementErrors = completed.stream()
                .mapToInt(s -> mergeErrors(Collections.singletonList(reports.get(s.getId())))
                        .stream().mapToInt(ErrorCount::count).sum())
                .sum();
        return new Totals(
                sessions.size(), completed.size(), sessions.size() - completed.size(),
                completed.stream().mapToInt(s -> orZero(s.getRoundsCompleted())).sum(),
                completed.stream().mapToInt(s -> orZero(s.getCorrectReps())).sum(),
                completed.stream().mapToInt(s -> orZero(s.getDurationSeconds())).sum(),
                average(completed.stream().map(s -> accuracyOf(reports.get(s.getId()))).filter(Objects::nonNull).toList()),
                expected, Math.max(0, expected - completedAgainstPlan),
                expected == 0 ? null : percent(completedAgainstPlan, expected),
                movementErrors);
    }

    private PeriodComparison previousPeriod(Long patientId, LocalDate from, LocalDate to) {
        long days = ChronoUnit.DAYS.between(from, to) + 1;
        LocalDate previousTo = from.minusDays(1);
        LocalDate previousFrom = previousTo.minusDays(days - 1);
        List<Session> completed = sessionsBetween(patientId, previousFrom, previousTo).stream()
                .filter(s -> s.getStatus() == Session.Status.COMPLETED).toList();
        Map<Long, SessionReport> reports = reportsFor(completed);
        return new PeriodComparison(previousFrom, previousTo, completed.size(),
                completed.stream().mapToInt(s -> orZero(s.getRoundsCompleted())).sum(),
                average(completed.stream().map(s -> accuracyOf(reports.get(s.getId()))).filter(Objects::nonNull).toList()));
    }

    private SessionPerformance toSessionPerformance(Session session, SessionReport report) {
        return new SessionPerformance(
                session.getId(), session.getStartedAt(), session.getExercise().getId(), session.getExercise().getName(),
                session.getStatus().name(), session.getRoundsCompleted(), session.getRoundsRequested(),
                session.getCorrectReps(), accuracyOf(report), session.getDurationSeconds(),
                mergeErrors(Collections.singletonList(report)).stream().mapToInt(ErrorCount::count).sum(),
                session.getAssignment() == null ? null : session.getAssignment().getId());
    }

    // ---------------------------------------------------------------- automated findings

    private AutomatedFindings findings(List<ExercisePerformance> exercises, List<PrescriptionAdherence> adherence) {
        List<String> improvements = new ArrayList<>();
        List<String> needsAttention = new ArrayList<>();
        for (ExercisePerformance exercise : exercises) {
            if (exercise.accuracyChangePts() != null && exercise.accuracyChangePts() >= MEANINGFUL_IMPROVEMENT_PTS) {
                improvements.add(String.format(Locale.ROOT, "%s: accuracy rose from %.0f%% to %.0f%%.",
                        exercise.exerciseName(), exercise.firstAccuracyPct(), exercise.latestAccuracyPct()));
            }
            if (exercise.averageAccuracyPct() != null && exercise.averageAccuracyPct() < LOW_ACCURACY_PCT) {
                needsAttention.add(String.format(Locale.ROOT, "%s: average accuracy %.0f%% (below %.0f%%).",
                        exercise.exerciseName(), exercise.averageAccuracyPct(), LOW_ACCURACY_PCT));
            }
            exercise.commonErrors().stream()
                    .filter(error -> error.count() >= RECURRING_ERROR_COUNT)
                    .findFirst()
                    .ifPresent(error -> needsAttention.add(String.format(Locale.ROOT, "%s: \"%s\" was flagged %d times.",
                            exercise.exerciseName(), error.message() == null ? error.code() : error.message(), error.count())));
        }
        for (PrescriptionAdherence prescription : adherence) {
            if (prescription.completionPct() != null && prescription.expectedSessions() >= 2
                    && prescription.completionPct() < LOW_COMPLETION_PCT) {
                needsAttention.add(String.format(Locale.ROOT, "%s: %d of about %d prescribed sessions completed.",
                        prescription.exerciseName(), prescription.completedSessions(), prescription.expectedSessions()));
            }
        }
        return new AutomatedFindings(improvements, needsAttention, FINDINGS_DISCLAIMER);
    }

    // ---------------------------------------------------------------- helpers

    private static Double accuracyOf(SessionReport report) {
        return report == null || report.getAccuracyPct() == null ? null : report.getAccuracyPct().doubleValue();
    }

    private List<ErrorCount> mergeErrors(List<SessionReport> reports) {
        Map<String, ErrorCount> merged = new LinkedHashMap<>();
        for (SessionReport report : reports) {
            if (report == null || report.getCommonMistakesJson() == null) continue;
            for (ErrorCount error : readErrors(report.getCommonMistakesJson())) {
                if (error.code() == null) continue;
                merged.merge(error.code(), error, (a, b) ->
                        new ErrorCount(a.code(), a.message() != null ? a.message() : b.message(), a.count() + b.count()));
            }
        }
        return merged.values().stream().sorted(Comparator.comparingInt(ErrorCount::count).reversed()).toList();
    }

    private List<ErrorCount> readErrors(String json) {
        try {
            return objectMapper.readValue(json, new TypeReference<List<ErrorCount>>() {});
        } catch (Exception unreadable) {
            return List.of();
        }
    }

    private Map<String, Double> averageMetrics(List<SessionReport> reports) {
        Map<String, List<Double>> values = new LinkedHashMap<>();
        for (SessionReport report : reports) {
            if (report == null || report.getMetricsJson() == null) continue;
            JsonNode metrics;
            try {
                metrics = objectMapper.readTree(report.getMetricsJson());
            } catch (Exception unreadable) {
                continue;
            }
            for (String key : AVERAGED_METRICS) {
                JsonNode value = metrics.path(key);
                if (value.isNumber()) values.computeIfAbsent(key, k -> new ArrayList<>()).add(value.asDouble());
            }
        }
        Map<String, Double> averages = new LinkedHashMap<>();
        values.forEach((key, list) -> averages.put(key, average(list)));
        return averages;
    }

    private static LocalDate latest(LocalDate... dates) {
        return Arrays.stream(dates).filter(Objects::nonNull).max(Comparator.naturalOrder()).orElseThrow();
    }

    private static LocalDate earliest(LocalDate... dates) {
        return Arrays.stream(dates).filter(Objects::nonNull).min(Comparator.naturalOrder()).orElseThrow();
    }

    private static Double average(List<Double> values) {
        return values.isEmpty() ? null : round(values.stream().mapToDouble(Double::doubleValue).average().orElse(0));
    }

    private static Double percent(int part, int whole) {
        return round(part * 100.0 / whole);
    }

    private static double round(double value) {
        return Math.round(value * 10.0) / 10.0;
    }

    private static int orZero(Integer value) {
        return value == null ? 0 : value;
    }
}
