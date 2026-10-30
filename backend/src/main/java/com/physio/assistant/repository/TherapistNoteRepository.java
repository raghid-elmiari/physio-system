package com.physio.assistant.repository;

import com.physio.assistant.entity.TherapistNote;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface TherapistNoteRepository extends JpaRepository<TherapistNote, Long> {
    @EntityGraph(attributePaths = {"author"})
    List<TherapistNote> findByPatientIdOrderByCreatedAtDesc(Long patientId);
}
