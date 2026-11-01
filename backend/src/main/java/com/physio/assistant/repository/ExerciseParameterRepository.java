package com.physio.assistant.repository;

import com.physio.assistant.entity.ExerciseParameter;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Collection;
import java.util.List;

public interface ExerciseParameterRepository extends JpaRepository<ExerciseParameter, Long> {
    List<ExerciseParameter> findByExerciseIdOrderBySortOrderAscIdAsc(Long exerciseId);
    List<ExerciseParameter> findByExerciseIdAndActiveTrueOrderBySortOrderAscIdAsc(Long exerciseId);
    List<ExerciseParameter> findByExerciseIdInOrderBySortOrderAscIdAsc(Collection<Long> exerciseIds);
}
