package com.physio.assistant.repository;

import com.physio.assistant.entity.ExerciseVideo;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Collection;
import java.util.List;

public interface ExerciseVideoRepository extends JpaRepository<ExerciseVideo, Long> {
    List<ExerciseVideo> findByActiveTrueAndInLibraryTrueOrderByCreatedAtDesc();
    List<ExerciseVideo> findByExerciseIdAndActiveTrueAndInLibraryTrueOrderByCreatedAtDesc(Long exerciseId);
    List<ExerciseVideo> findByExerciseIdInAndActiveTrueAndInLibraryTrueOrderByCreatedAtDesc(Collection<Long> exerciseIds);
}
