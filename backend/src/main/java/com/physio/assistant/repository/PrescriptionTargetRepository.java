package com.physio.assistant.repository;

import com.physio.assistant.entity.PrescriptionTarget;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface PrescriptionTargetRepository extends JpaRepository<PrescriptionTarget, Long> {
    List<PrescriptionTarget> findByAssignmentIdOrderByIdAsc(Long assignmentId);
}
