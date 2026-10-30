package com.physio.assistant.dto;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.time.LocalDateTime;

public class ExerciseDtos {

    public record ExerciseResponse(
            Long id,
            String name,
            String description,
            String instructions,
            String cameraSetup,
            String bodyRegion,
            Integer defaultReps,
            String analyzerKey,
            boolean cameraMonitoringSupported,
            JsonNode analysisConfig
    ) {}

    /** An exercise prescription as seen by the patient and the physiotherapist. */
    public record AssignmentResponse(
            Long id,
            ExerciseResponse exercise,
            Integer targetReps,
            Integer setsPerSession,
            Integer sessionsPerWeek,
            String notes,
            String assignedBy,
            LocalDateTime createdAt,
            long completedSessionsLast7Days,
            String status,
            Integer durationSeconds,
            Integer restSeconds,
            LocalDate startDate,
            LocalDate endDate,
            String difficulty,
            Long previousAssignmentId,
            LocalDateTime updatedAt
    ) {}

    /**
     * A therapist-defined exercise analysed by matching a reference recording (analyzer
     * "reference_dtw"). analysisConfig must contain the reference built on the device from the
     * therapist's video: joint-angle curves only, never video or images.
     */
    public record ReferenceExerciseRequest(
            @NotBlank(message = "name is required") @Size(max = 150) String name,
            @Size(max = 5000) String description,
            @Size(max = 5000) String instructions,
            @Size(max = 500) String cameraSetup,
            @Size(max = 50) String bodyRegion,
            @NotNull(message = "defaultReps is required") @Min(1) @Max(100) Integer defaultReps,
            @NotNull(message = "analysisConfig is required") JsonNode analysisConfig
    ) {}

    /** Exercise prescription. Also used to revise one, which creates a new version. */
    public record CreateAssignmentRequest(
            @NotNull(message = "exerciseId is required") Long exerciseId,
            @NotNull(message = "targetReps is required") @Min(1) @Max(100) Integer targetReps,
            @Min(1) @Max(10) Integer setsPerSession,
            @Min(1) @Max(21) Integer sessionsPerWeek,
            @Size(max = 500) String notes,
            @Min(0) @Max(3600) Integer durationSeconds,
            @Min(0) @Max(3600) Integer restSeconds,
            LocalDate startDate,
            LocalDate endDate,
            @Pattern(regexp = "EASY|MODERATE|HARD", message = "difficulty must be EASY, MODERATE or HARD") String difficulty
    ) {}

    public record AssignmentStatusRequest(
            @NotBlank(message = "status is required")
            @Pattern(regexp = "ACTIVE|PAUSED|DISCONTINUED|COMPLETED", message = "status must be ACTIVE, PAUSED, DISCONTINUED or COMPLETED")
            String status
    ) {}
}
