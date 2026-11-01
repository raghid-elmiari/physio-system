package com.physio.assistant.repository;

import com.physio.assistant.entity.ExercisePerformance;
import org.springframework.data.jpa.repository.JpaRepository;
import java.time.LocalDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface ExercisePerformanceRepository extends JpaRepository<ExercisePerformance, Long> {
    List<ExercisePerformance> findByPatientIdOrderByPerformedAtDesc(Long patientId);
    List<ExercisePerformance> findByPatientIdAndPerformedAtBetweenOrderByPerformedAtAsc(Long patientId, LocalDateTime from, LocalDateTime to);
    List<ExercisePerformance> findByAssignmentIdInOrderByPerformedAtAsc(Collection<Long> assignmentIds);
    Optional<ExercisePerformance> findBySessionId(Long sessionId);
}
