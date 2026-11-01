package com.physio.assistant.repository;

import com.physio.assistant.entity.PatientVideoSubmission;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Collection;
import java.util.List;

public interface PatientVideoSubmissionRepository extends JpaRepository<PatientVideoSubmission, Long> {
    List<PatientVideoSubmission> findByPatientIdOrderByCreatedAtDesc(Long patientId);
    List<PatientVideoSubmission> findByPatientIdInOrderByCreatedAtDesc(Collection<Long> patientIds);
    List<PatientVideoSubmission> findByPatientIdAndStatus(Long patientId, PatientVideoSubmission.Status status);
    long countByPatientIdInAndStatus(Collection<Long> patientIds, PatientVideoSubmission.Status status);
}
