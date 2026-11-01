package com.physio.assistant.repository;

import com.physio.assistant.entity.PatientVideoResource;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface PatientVideoResourceRepository extends JpaRepository<PatientVideoResource, Long> {
    List<PatientVideoResource> findByPatientIdAndActiveTrueOrderByCreatedAtDesc(Long patientId);
    Optional<PatientVideoResource> findFirstByPatientIdAndVideoIdAndActiveTrue(Long patientId, Long videoId);
}
