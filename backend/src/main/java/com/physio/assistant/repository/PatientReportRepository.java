package com.physio.assistant.repository;

import com.physio.assistant.entity.PatientReport;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface PatientReportRepository extends JpaRepository<PatientReport, Long> {
    @EntityGraph(attributePaths = {"author"})
    List<PatientReport> findByPatientIdOrderByCreatedAtDesc(Long patientId);

    @EntityGraph(attributePaths = {"author"})
    List<PatientReport> findByPatientIdAndSharedWithPatientTrueOrderByCreatedAtDesc(Long patientId);
}
