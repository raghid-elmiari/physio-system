package com.physio.assistant.dto;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

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
            JsonNode analysisConfig,
            String category,
            String difficultyLevel,
            boolean active,
            List<ParameterResponse> parameters,
            String createdBy,
            LocalDateTime updatedAt
    ) {}

    /** A configurable measurement of a library exercise. */
    public record ParameterResponse(
            Long id, String code, String label, String measurementType, String unit,
            boolean rangeMeasurement, Double minValid, Double maxValid, Double normalMin, Double normalMax,
            boolean higherIsBetter, boolean assessmentEnabled, String cvMetricKey, int sortOrder, boolean active
    ) {}

    /** Patient-specific target for one parameter of a prescription. */
    public record TargetResponse(
            Long id, Long parameterId, String code, String label, String unit, String measurementType,
            boolean rangeMeasurement, boolean higherIsBetter, Double targetValue, Double targetMin, Double targetMax, String note
    ) {}

    public record TargetRequest(
            @NotNull(message = "parameterId is required") Long parameterId,
            Double targetValue,
            Double targetMin,
            Double targetMax,
            @Size(max = 300) String note
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
            LocalDateTime updatedAt,
            String instructions,
            String safetyInstructions,
            String expectedProgression,
            String changeReason,
            String approvedBy,
            LocalDateTime approvedAt,
            String approvalNote,
            List<TargetResponse> targets,
            /** Whether the patient may start this exercise today, and if not, why. */
            boolean startable,
            String startBlockedReason
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
            @Pattern(regexp = "EASY|MODERATE|HARD", message = "difficulty must be EASY, MODERATE or HARD") String difficulty,
            @Size(max = 4000) String instructions,
            @Size(max = 1000) String safetyInstructions,
            @Size(max = 1000) String expectedProgression,
            @Size(max = 500) String changeReason,
            @Valid @Size(max = 20) List<TargetRequest> targets
    ) {}

    /** The treating physiotherapist confirms the patient is ready and puts the prescription in force. */
    public record ApprovePrescriptionRequest(
            @NotNull(message = "Confirm that the patient is clinically ready") Boolean readinessConfirmed,
            @Size(max = 500) String note
    ) {}

    // ------------------------------------------------------------ library management

    public record ParameterRequest(
            Long id, // existing parameter to update; null creates one
            @NotBlank(message = "code is required") @Pattern(regexp = "^[a-z][a-z0-9_]{0,49}$",
                    message = "code must be lower-case letters, digits and underscores") String code,
            @NotBlank(message = "label is required") @Size(max = 100) String label,
            @NotBlank @Pattern(regexp = "ANGLE|FLEXIBILITY|REPETITIONS|DURATION|DISTANCE|PAIN|CUSTOM",
                    message = "Unknown measurement type") String measurementType,
            @NotBlank(message = "unit is required") @Size(max = 20) String unit,
            boolean rangeMeasurement,
            Double minValid,
            Double maxValid,
            Double normalMin,
            Double normalMax,
            Boolean higherIsBetter,
            Boolean assessmentEnabled,
            @Size(max = 64) String cvMetricKey
    ) {}

    /** Create or edit a library exercise (metadata and measurement parameters, not the camera analysis). */
    public record LibraryExerciseRequest(
            @NotBlank(message = "name is required") @Size(max = 150) String name,
            @Size(max = 5000) String description,
            @Size(max = 5000) String instructions,
            @Size(max = 500) String cameraSetup,
            @Size(max = 50) String bodyRegion,
            @Size(max = 50) String category,
            @Pattern(regexp = "EASY|MODERATE|HARD", message = "difficultyLevel must be EASY, MODERATE or HARD") String difficultyLevel,
            @NotNull(message = "defaultReps is required") @Min(1) @Max(100) Integer defaultReps,
            @Valid @Size(max = 20) List<ParameterRequest> parameters
    ) {}

    public record AssignmentStatusRequest(
            @NotBlank(message = "status is required")
            @Pattern(regexp = "ACTIVE|PAUSED|DISCONTINUED|COMPLETED", message = "status must be ACTIVE, PAUSED, DISCONTINUED or COMPLETED (use /approve for new prescriptions)")
            String status
    ) {}
}
