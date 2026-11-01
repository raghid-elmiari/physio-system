package com.physio.assistant.repository;

import com.physio.assistant.entity.ExerciseAssignment;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Collection;
import java.util.List;

public interface ExerciseAssignmentRepository extends JpaRepository<ExerciseAssignment, Long> {

    @EntityGraph(attributePaths = {"exercise", "assignedBy"})
    List<ExerciseAssignment> findByPatientIdAndActiveTrueOrderByCreatedAtDesc(Long patientId);

    /** Every prescription the patient has ever had, newest first (prescription history). */
    @EntityGraph(attributePaths = {"exercise", "assignedBy"})
    List<ExerciseAssignment> findByPatientIdOrderByCreatedAtDesc(Long patientId);

    @EntityGraph(attributePaths = {"exercise", "patient"})
    List<ExerciseAssignment> findByPatientIdIn(Collection<Long> patientIds);

    @EntityGraph(attributePaths = {"exercise", "assignedBy"})
    List<ExerciseAssignment> findByPatientIdAndStatusInOrderByCreatedAtDesc(Long patientId, Collection<ExerciseAssignment.Status> statuses);

    @EntityGraph(attributePaths = {"exercise", "patient"})
    List<ExerciseAssignment> findByPatientIdInAndStatus(Collection<Long> patientIds, ExerciseAssignment.Status status);

    long countByPatientIdAndStatusIn(Long patientId, Collection<ExerciseAssignment.Status> statuses);
}
