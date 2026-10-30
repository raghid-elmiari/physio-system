package com.physio.assistant.service;

import com.physio.assistant.dto.ProgressDtos.*;
import com.physio.assistant.entity.Session;
import com.physio.assistant.entity.SessionReport;
import com.physio.assistant.repository.SessionReportRepository;
import com.physio.assistant.repository.SessionRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;

/** Aggregates a patient's completed sessions into progress-over-time figures. */
@Service
public class ProgressService {

    private final SessionRepository sessionRepository;
    private final SessionReportRepository reportRepository;

    public ProgressService(SessionRepository sessionRepository, SessionReportRepository reportRepository) {
        this.sessionRepository = sessionRepository;
        this.reportRepository = reportRepository;
    }

    @Transactional(readOnly = true)
    public ProgressResponse forUser(Long userId, int days) {
        LocalDateTime since = LocalDate.now().minusDays(Math.max(1, Math.min(days, 365))).atStartOfDay();
        List<Session> sessions = sessionRepository.findByUserIdAndStartedAtAfterOrderByStartedAtAsc(userId, since);
        List<Session> completed = sessions.stream().filter(s -> s.getStatus() == Session.Status.COMPLETED).toList();
        Map<Long, SessionReport> reports = reportRepository
                .findBySessionIdIn(completed.stream().map(Session::getId).toList()).stream()
                .collect(Collectors.toMap(r -> r.getSession().getId(), Function.identity()));

        List<TimelinePoint> timeline = completed.stream().map(s -> {
            SessionReport r = reports.get(s.getId());
            return new TimelinePoint(s.getId(), s.getStartedAt(), s.getExercise().getId(), s.getExercise().getName(),
                    r == null ? null : r.getAccuracyPct().doubleValue(), s.getRoundsCompleted(), s.getCorrectReps(),
                    s.getDurationSeconds());
        }).toList();

        int totalReps = completed.stream().mapToInt(s -> nz(s.getRoundsCompleted())).sum();
        int correctReps = completed.stream().mapToInt(s -> nz(s.getCorrectReps())).sum();
        int totalSeconds = completed.stream().mapToInt(s -> nz(s.getDurationSeconds())).sum();
        OptionalDouble avg = timeline.stream().filter(p -> p.accuracyPct() != null)
                .mapToDouble(TimelinePoint::accuracyPct).average();
        LocalDateTime weekAgo = LocalDateTime.now().minusDays(7);
        int last7 = (int) completed.stream().filter(s -> s.getStartedAt().isAfter(weekAgo)).count();

        Totals totals = new Totals(sessions.size(), completed.size(), totalReps, correctReps,
                avg.isPresent() ? round(avg.getAsDouble()) : null, Math.round(totalSeconds / 60f), last7,
                streak(completed));

        Map<Long, List<TimelinePoint>> byExerciseId = timeline.stream()
                .collect(Collectors.groupingBy(TimelinePoint::exerciseId, LinkedHashMap::new, Collectors.toList()));
        List<ExerciseProgress> byExercise = byExerciseId.values().stream().map(points -> {
            TimelinePoint last = points.get(points.size() - 1);
            OptionalDouble best = points.stream().filter(p -> p.accuracyPct() != null).mapToDouble(TimelinePoint::accuracyPct).max();
            return new ExerciseProgress(last.exerciseId(), last.exerciseName(), points.size(),
                    points.stream().mapToInt(p -> nz(p.reps())).sum(),
                    best.isPresent() ? best.getAsDouble() : null, last.accuracyPct(), last.date());
        }).toList();

        return new ProgressResponse(totals, byExercise, timeline);
    }

    /** Consecutive days (ending today or yesterday) with at least one completed session. */
    private int streak(List<Session> completed) {
        Set<LocalDate> days = completed.stream().map(s -> s.getStartedAt().toLocalDate()).collect(Collectors.toSet());
        LocalDate day = LocalDate.now();
        if (!days.contains(day)) day = day.minusDays(1);
        int n = 0;
        while (days.contains(day)) {
            n++;
            day = day.minusDays(1);
        }
        return n;
    }

    private static int nz(Integer v) {
        return v == null ? 0 : v;
    }

    private static double round(double v) {
        return Math.round(v * 100.0) / 100.0;
    }
}
