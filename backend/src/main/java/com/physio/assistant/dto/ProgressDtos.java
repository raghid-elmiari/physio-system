package com.physio.assistant.dto;

import java.time.LocalDateTime;
import java.util.List;

public class ProgressDtos {

    public record ProgressResponse(
            Totals totals,
            List<ExerciseProgress> byExercise,
            List<TimelinePoint> timeline
    ) {}

    public record Totals(
            int sessions,
            int completedSessions,
            int totalReps,
            int correctReps,
            Double averageAccuracyPct,
            int totalMinutes,
            int sessionsLast7Days,
            int activeDaysStreak
    ) {}

    public record ExerciseProgress(
            Long exerciseId, String exerciseName, int completedSessions, int totalReps,
            Double bestAccuracyPct, Double latestAccuracyPct, LocalDateTime lastSessionAt
    ) {}

    public record TimelinePoint(
            Long sessionId, LocalDateTime date, Long exerciseId, String exerciseName,
            Double accuracyPct, Integer reps, Integer correctReps, Integer durationSeconds
    ) {}
}
