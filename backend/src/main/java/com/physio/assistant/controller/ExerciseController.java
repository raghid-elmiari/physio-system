package com.physio.assistant.controller;

import com.physio.assistant.dto.ExerciseDtos.ExerciseResponse;
import com.physio.assistant.service.ExerciseService;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/exercises")
public class ExerciseController {

    private final ExerciseService exerciseService;

    public ExerciseController(ExerciseService exerciseService) {
        this.exerciseService = exerciseService;
    }

    @GetMapping
    public List<ExerciseResponse> list() {
        return exerciseService.listActive();
    }

    /** Includes analysisConfig: the per-exercise thresholds the on-device analyzer uses. */
    @GetMapping("/{id}")
    public ExerciseResponse get(@PathVariable Long id) {
        return exerciseService.get(id);
    }
}
