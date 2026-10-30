package com.physio.assistant.repository;

import com.physio.assistant.entity.Exercise;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface ExerciseRepository extends JpaRepository<Exercise, Long> {
    List<Exercise> findByActiveTrueOrderByNameAsc();
    Optional<Exercise> findFirstByAnalyzerKey(String analyzerKey);
}
