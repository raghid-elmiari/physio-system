package com.physio.assistant.dto;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

public class SessionDtos {

    public record StartSessionRequest(
            @NotNull(message = "exerciseId is required") Long exerciseId,
            @Min(1) @Max(200) Integer roundsRequested, // optional: defaults to the assignment / exercise default
            Long assignmentId,
            @Size(max = 64) String clientSessionId, // optional idempotency key
            String deviceId // optional — which UNO Q/camera device is running this session, if any
    ) {}

    public record SessionResponse(
            Long id,
            Long exerciseId,
            String exerciseName,
            Long assignmentId,
            String status,
            Integer roundsRequested,
            Integer roundsCompleted,
            Integer correctReps,
            Integer durationSeconds,
            String clientSessionId,
            LocalDateTime startedAt,
            LocalDateTime endedAt
    ) {}

    /** One on-device analysis event (rep completed, movement error, ...). */
    public record ClientEvent(
            @NotBlank @Size(max = 64) String eventUid,
            @NotNull Integer sequenceNo,
            @NotNull LocalDateTime eventTimestamp,
            @NotBlank @Size(max = 30) String eventType,
            @Size(max = 50) String errorCode,
            @Size(max = 50) String jointName,
            Double value,
            @Size(max = 255) String message,
            Integer repNumber
    ) {}

    /**
     * Summary produced on-device when a session ends. Only derived metrics are sent —
     * never raw video or per-frame landmarks.
     */
    public record CompleteSessionRequest(
            @Min(0) @Max(1000) Integer roundsCompleted,
            @Min(0) @Max(1000) Integer correctReps,
            @Min(0) @Max(86400) Integer durationSeconds,
            Map<String, Integer> errorCounts,   // errorCode -> occurrences
            Map<String, String> errorMessages,  // errorCode -> human-readable message
            JsonNode metrics,                   // free-form numeric metrics, e.g. peak angle, avg ROM, tracking quality
            @Valid @Size(max = 2000) List<ClientEvent> events
    ) {}

    /** Upload of a session that was performed entirely offline. Idempotent on clientSessionId. */
    public record SyncSessionRequest(
            @NotBlank @Size(max = 64) String clientSessionId,
            @NotNull Long exerciseId,
            Long assignmentId,
            @NotNull @Min(1) @Max(200) Integer roundsRequested,
            @NotNull LocalDateTime startedAt,
            LocalDateTime endedAt,
            @NotNull @Valid CompleteSessionRequest summary
    ) {}

    public record MistakeSummary(String code, String message, int count) {}

    public record SessionReportResponse(
            Long sessionId,
            Long exerciseId,
            String exerciseName,
            String accuracyPct,
            Integer totalReps,
            Integer correctReps,
            Integer roundsRequested,
            Integer durationSeconds,
            List<MistakeSummary> commonMistakes,
            String commonMistakesJson,
            JsonNode metrics,
            LocalDateTime startedAt,
            LocalDateTime generatedAt
    ) {}

    public record SessionEventResponse(
            Integer sequenceNo, LocalDateTime eventTimestamp, String eventType, String errorCode,
            String jointName, Double value, String message, Integer repNumber
    ) {}
}
