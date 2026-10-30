package com.physio.assistant.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.time.LocalDateTime;

public class EventDtos {

    // Matches the device message format used by the AI service / edge device when
    // pushing a posture-deviation event for a live session.
    public record IngestEventRequest(
            @NotBlank String eventUid,
            @NotNull Integer sequenceNo,
            @NotNull LocalDateTime eventTimestamp,
            @NotBlank String jointName,
            @NotNull BigDecimal deviationValue,
            String feedbackMessage,
            String source // "GEOMETRIC_COMPARISON" or "CLASSIFIER"
    ) {}
}
