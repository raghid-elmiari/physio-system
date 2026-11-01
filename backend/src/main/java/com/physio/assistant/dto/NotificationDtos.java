package com.physio.assistant.dto;

import java.time.LocalDateTime;

public class NotificationDtos {

    public record NotificationResponse(
            Long id, String type, String title, String message, String link,
            String entityType, Long entityId, boolean read, LocalDateTime readAt, LocalDateTime createdAt
    ) {}

    public record UnreadCount(long unread) {}

    public record MarkReadRequest(Boolean read) {}
}
