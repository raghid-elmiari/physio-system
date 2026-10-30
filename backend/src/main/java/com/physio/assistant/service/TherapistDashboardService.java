package com.physio.assistant.service;

import com.physio.assistant.dto.DashboardDtos.*;
import com.physio.assistant.entity.ExerciseAssignment;
import com.physio.assistant.entity.Session;
import com.physio.assistant.entity.User;
import com.physio.assistant.repository.ExerciseAssignmentRepository;
import com.physio.assistant.repository.SessionReportRepository;
import com.physio.assistant.repository.SessionRepository;
import com.physio.assistant.security.AuthPrincipal;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.temporal.TemporalAdjusters;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Caseload overview for the physiotherapist dashboard. Everything is computed from the
 * sessions patients actually recorded; nothing is estimated except "sessions due this
 * week", which follows directly from each prescription's weekly frequency.
 */
@Service
public class TherapistDashboardService {

    private static final int RECENT_ACTIVITY_LIMIT = 12;
    private static final int TREND_WEEKS = 8;
    private static final int INACTIVITY_DAYS = 7;
    private static final int ACCURACY_WINDOW_SESSIONS = 3;
    private static final double LOW_ACCURACY_PCT = 60.0;
    private static final int REPEATED_INTERRUPTIONS = 2;

    private final PatientAccessPolicy accessPolicy;
    private final SessionRepository sessionRepository;
    private final SessionReportRepository sessionReportRepository;
    private final ExerciseAssignmentRepository assignmentRepository;

    public TherapistDashboardService(PatientAccessPolicy accessPolicy, SessionRepository sessionRepository,
                                     SessionReportRepository sessionReportRepository,
                                     ExerciseAssignmentRepository assignmentRepository) {
        this.accessPolicy = accessPolicy;
        this.sessionRepository = sessionRepository;
        this.sessionReportRepository = sessionReportRepository;
        this.assignmentRepository = assignmentRepository;
    }

    @Transactional(readOnly = true)
    public DashboardOverview overview(AuthPrincipal therapist) {
        LocalDate today = LocalDate.now();
        LocalDateTime now = LocalDateTime.now();
        LocalDate weekStart = today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
        LocalDateTime trendStart = weekStart.minusWeeks(TREND_WEEKS - 1).atStartOfDay();
        LocalDateTime thirtyDaysAgo = now.minusDays(30);

        List<User> patients = accessPolicy.caseload(therapist);
        List<Long> patientIds = patients.stream().map(User::getId).toList();
        if (patientIds.isEmpty()) return emptyOverview(weekStart, now);

        LocalDateTime loadFrom = trendStart.isBefore(thirtyDaysAgo) ? trendStart : thirtyDaysAgo;
        List<Session> sessions = sessionRepository.findByUserIdInAndStartedAtAfterOrderByStartedAtDesc(patientIds, loadFrom);
        Map<Long, Double> accuracyBySession = accuracyBySession(sessions);
        Map<Long, List<Session>> sessionsByPatient = sessions.stream()
                .collect(Collectors.groupingBy(s -> s.getUser().getId()));

        List<ExerciseAssignment> inForce = assignmentRepository.findByPatientIdIn(patientIds).stream()
                .filter(p -> p.isInForceOn(today))
                .toList();
        Map<Long, List<ExerciseAssignment>> prescriptionsByPatient = inForce.stream()
                .collect(Collectors.groupingBy(p -> p.getPatient().getId()));

        List<AttentionItem> attention = new ArrayList<>();
        int activePatients = 0;
        int disabledAccounts = 0;
        for (User patient : patients) {
            if (patient.getStatus() == User.Status.DISABLED) {
                disabledAccounts++;
                continue;
            }
            List<ExerciseAssignment> patientPrescriptions = prescriptionsByPatient.getOrDefault(patient.getId(), List.of());
            if (!patientPrescriptions.isEmpty()) activePatients++;
            List<Session> patientSessions = sessionsByPatient.getOrDefault(patient.getId(), List.of());
            List<String> reasons = attentionReasons(patientPrescriptions, patientSessions, accuracyBySession, now);
            if (!reasons.isEmpty()) {
                LocalDateTime lastSessionAt = sessionRepository.findFirstByUserIdOrderByStartedAtDesc(patient.getId())
                        .map(Session::getStartedAt).orElse(null);
                attention.add(new AttentionItem(patient.getId(), patient.getFullName(), reasons, lastSessionAt));
            }
        }

        List<Session> last30Days = sessions.stream().filter(s -> s.getStartedAt().isAfter(thirtyDaysAgo)).toList();
        List<Session> completedLast30Days = completed(last30Days);
        List<Session> completedThisWeek = completed(sessions).stream()
                .filter(s -> !s.getStartedAt().toLocalDate().isBefore(weekStart)).toList();

        return new DashboardOverview(
                new PatientCounts(patients.size(), activePatients, attention.size(), disabledAccounts),
                inForce.size(),
                completedLast30Days.size(),
                (int) last30Days.stream().filter(s -> s.getStatus() == Session.Status.ABORTED).count(),
                completedThisWeek.size(),
                sessionsDueThisWeek(inForce, completedThisWeek),
                averageAccuracy(completedLast30Days, accuracyBySession),
                attention,
                sessions.stream().limit(RECENT_ACTIVITY_LIMIT).map(s -> toActivity(s, accuracyBySession)).toList(),
                weeklyProgress(completed(sessions), accuracyBySession, weekStart),
                now);
    }

    /**
     * A patient needs attention when, with a prescription in force, they have not completed a
     * session for a week, their recent movement accuracy is low, or they keep stopping sessions early.
     */
    private List<String> attentionReasons(List<ExerciseAssignment> prescriptions, List<Session> sessions,
                                          Map<Long, Double> accuracyBySession, LocalDateTime now) {
        List<String> reasons = new ArrayList<>();
        if (prescriptions.isEmpty()) return reasons;

        List<Session> completed = completed(sessions);
        boolean completedRecently = completed.stream()
                .anyMatch(s -> s.getStartedAt().isAfter(now.minusDays(INACTIVITY_DAYS)));
        if (!completedRecently) reasons.add("No completed session in the last " + INACTIVITY_DAYS + " days");

        List<Double> recentAccuracy = completed.stream()
                .map(s -> accuracyBySession.get(s.getId())).filter(Objects::nonNull)
                .limit(ACCURACY_WINDOW_SESSIONS).toList();
        if (recentAccuracy.size() == ACCURACY_WINDOW_SESSIONS) {
            double average = recentAccuracy.stream().mapToDouble(Double::doubleValue).average().orElse(100);
            if (average < LOW_ACCURACY_PCT) {
                reasons.add(String.format(Locale.ROOT, "Average accuracy %.0f%% over the last %d sessions",
                        average, ACCURACY_WINDOW_SESSIONS));
            }
        }

        long interruptions = sessions.stream()
                .filter(s -> s.getStatus() == Session.Status.ABORTED)
                .filter(s -> s.getStartedAt().isAfter(now.minusDays(INACTIVITY_DAYS)))
                .count();
        if (interruptions >= REPEATED_INTERRUPTIONS) {
            reasons.add(interruptions + " sessions stopped early this week");
        }
        return reasons;
    }

    /** Sum over prescriptions in force of (weekly frequency − sessions already completed for it this week). */
    private static int sessionsDueThisWeek(List<ExerciseAssignment> inForce, List<Session> completedThisWeek) {
        Map<Long, Long> doneByPrescription = completedThisWeek.stream()
                .filter(s -> s.getAssignment() != null)
                .collect(Collectors.groupingBy(s -> s.getAssignment().getId(), Collectors.counting()));
        return inForce.stream()
                .filter(p -> p.getSessionsPerWeek() != null)
                .mapToInt(p -> (int) Math.max(0, p.getSessionsPerWeek() - doneByPrescription.getOrDefault(p.getId(), 0L)))
                .sum();
    }

    private static List<WeeklyProgressPoint> weeklyProgress(List<Session> completed, Map<Long, Double> accuracyBySession,
                                                            LocalDate currentWeekStart) {
        List<WeeklyProgressPoint> points = new ArrayList<>();
        for (int weeksAgo = TREND_WEEKS - 1; weeksAgo >= 0; weeksAgo--) {
            LocalDate start = currentWeekStart.minusWeeks(weeksAgo);
            LocalDate end = start.plusWeeks(1);
            List<Session> inWeek = completed.stream()
                    .filter(s -> !s.getStartedAt().toLocalDate().isBefore(start) && s.getStartedAt().toLocalDate().isBefore(end))
                    .toList();
            points.add(new WeeklyProgressPoint(start, inWeek.size(), averageAccuracy(inWeek, accuracyBySession)));
        }
        return points;
    }

    private Map<Long, Double> accuracyBySession(List<Session> sessions) {
        List<Long> completedIds = completed(sessions).stream().map(Session::getId).toList();
        if (completedIds.isEmpty()) return Map.of();
        return sessionReportRepository.findBySessionIdIn(completedIds).stream()
                .filter(r -> r.getAccuracyPct() != null)
                .collect(Collectors.toMap(r -> r.getSession().getId(), r -> r.getAccuracyPct().doubleValue(),
                        (a, b) -> a));
    }

    private static ActivityItem toActivity(Session session, Map<Long, Double> accuracyBySession) {
        return new ActivityItem(session.getId(), session.getUser().getId(), session.getUser().getFullName(),
                session.getExercise().getName(), session.getStatus().name(),
                session.getRoundsCompleted(), session.getRoundsRequested(),
                accuracyBySession.get(session.getId()), session.getStartedAt());
    }

    private static Double averageAccuracy(List<Session> sessions, Map<Long, Double> accuracyBySession) {
        OptionalDouble average = sessions.stream().map(s -> accuracyBySession.get(s.getId()))
                .filter(Objects::nonNull).mapToDouble(Double::doubleValue).average();
        return average.isPresent() ? Math.round(average.getAsDouble() * 10.0) / 10.0 : null;
    }

    private static List<Session> completed(List<Session> sessions) {
        return sessions.stream().filter(s -> s.getStatus() == Session.Status.COMPLETED).toList();
    }

    private static DashboardOverview emptyOverview(LocalDate weekStart, LocalDateTime now) {
        return new DashboardOverview(new PatientCounts(0, 0, 0, 0), 0, 0, 0, 0, 0, null,
                List.of(), List.of(), weeklyProgress(List.of(), Map.of(), weekStart), now);
    }
}
