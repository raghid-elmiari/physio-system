package com.physio.assistant.repository;

import com.physio.assistant.entity.PatientAssessment;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface PatientAssessmentRepository extends JpaRepository<PatientAssessment, Long> {
    List<PatientAssessment> findByPatientIdOrderByCreatedAtDesc(Long patientId);
    List<PatientAssessment> findByPatientIdAndStatusIn(Long patientId, Collection<PatientAssessment.Status> statuses);
    List<PatientAssessment> findByPatientIdInAndStatusInOrderBySubmittedAtAsc(Collection<Long> patientIds,
                                                                             Collection<PatientAssessment.Status> statuses);
    long countByPatientIdInAndStatusIn(Collection<Long> patientIds, Collection<PatientAssessment.Status> statuses);
    /** Approved assessments of a patient, oldest approval first. */
    List<PatientAssessment> findByPatientIdAndStatusOrderByApprovedAtAsc(Long patientId, PatientAssessment.Status status);
    Optional<PatientAssessment> findFirstByPatientIdOrderByCreatedAtDesc(Long patientId);
}
