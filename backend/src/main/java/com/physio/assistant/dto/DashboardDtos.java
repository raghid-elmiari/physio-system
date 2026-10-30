package com.physio.assistant.dto;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

/** Physiotherapist dashboard: caseload-wide figures, all derived from recorded sessions. */
public class DashboardDtos {

    public record DashboardOverview(
            PatientCounts patients,
            int activePrescriptions,
            int completedSessionsLast30Days,
            int interruptedSessionsLast30Days,
            int sessionsCompletedThisWeek,
            int sessionsDueThisWeek,
            Double averageAccuracyLast30Days,
            List<AttentionItem> patientsNeedingAttention,
            List<ActivityItem> recentActivity,
            List<WeeklyProgressPoint> weeklyProgress,
            LocalDateTime generatedAt
    ) {}

    /**
     * @param active patients whose account is enabled and who have at least one prescription in force
     * @param disabledAccounts patients whose account has been deactivated
     */
    public record PatientCounts(int total, int active, int needingAttention, int disabledAccounts) {}

    public record AttentionItem(Long patientId, String patientName, List<String> reasons, LocalDateTime lastSessionAt) {}

    public record ActivityItem(
            Long sessionId, Long patientId, String patientName, String exerciseName, String status,
            Integer roundsCompleted, Integer roundsRequested, Double accuracyPct, LocalDateTime startedAt
    ) {}

    public record WeeklyProgressPoint(LocalDate weekStart, int completedSessions, Double averageAccuracyPct) {}
}
