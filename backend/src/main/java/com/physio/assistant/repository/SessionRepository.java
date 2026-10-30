package com.physio.assistant.repository;

import com.physio.assistant.entity.Session;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import java.time.LocalDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface SessionRepository extends JpaRepository<Session, Long> {
    @EntityGraph(attributePaths = {"exercise"})
    List<Session> findByUserIdOrderByStartedAtDesc(Long userId);

    @EntityGraph(attributePaths = {"exercise"})
    List<Session> findByUserIdAndExerciseIdOrderByStartedAtDesc(Long userId, Long exerciseId);

    @EntityGraph(attributePaths = {"exercise"})
    List<Session> findByUserIdAndStartedAtAfterOrderByStartedAtAsc(Long userId, LocalDateTime after);

    @EntityGraph(attributePaths = {"exercise", "assignment"})
    List<Session> findByUserIdAndStartedAtBetweenOrderByStartedAtAsc(Long userId, LocalDateTime from, LocalDateTime to);

    /** Sessions of a group of patients (a physiotherapist's caseload) since a given time, newest first. */
    @EntityGraph(attributePaths = {"exercise", "user", "assignment"})
    List<Session> findByUserIdInAndStartedAtAfterOrderByStartedAtDesc(Collection<Long> userIds, LocalDateTime after);

    long countByAssignmentIdAndStatusAndStartedAtAfter(Long assignmentId, Session.Status status, LocalDateTime after);

    Optional<Session> findFirstByUserIdOrderByStartedAtDesc(Long userId);

    Optional<Session> findByUserIdAndClientSessionId(Long userId, String clientSessionId);

    @Modifying
    @Query("update Session s set s.status = com.physio.assistant.entity.Session.Status.ABORTED, s.endedAt = :now "
            + "where s.status = com.physio.assistant.entity.Session.Status.IN_PROGRESS and s.startedAt < :cutoff")
    int abortStale(LocalDateTime cutoff, LocalDateTime now);
}
