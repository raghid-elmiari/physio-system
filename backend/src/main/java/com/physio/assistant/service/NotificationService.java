package com.physio.assistant.service;

import com.physio.assistant.dto.NotificationDtos.NotificationResponse;
import com.physio.assistant.dto.NotificationDtos.UnreadCount;
import com.physio.assistant.entity.Notification;
import com.physio.assistant.entity.User;
import com.physio.assistant.exception.ApiException;
import com.physio.assistant.repository.NotificationRepository;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;

/** Persistent in-app notifications. Created only by real backend events, inside their transaction. */
@Service
public class NotificationService {

    public static final String VIDEO_SUBMITTED = "VIDEO_SUBMITTED";
    public static final String VIDEO_APPROVED = "VIDEO_APPROVED";
    public static final String VIDEO_REJECTED = "VIDEO_REJECTED";
    public static final String VIDEO_REVISION_REQUESTED = "VIDEO_REVISION_REQUESTED";
    public static final String ASSESSMENT_SUBMITTED = "ASSESSMENT_SUBMITTED";
    public static final String ASSESSMENT_APPROVED = "ASSESSMENT_APPROVED";
    public static final String ASSESSMENT_REVISION_REQUESTED = "ASSESSMENT_REVISION_REQUESTED";
    public static final String PRESCRIPTION_APPROVED = "PRESCRIPTION_APPROVED";
    public static final String PRESCRIPTION_CHANGED = "PRESCRIPTION_CHANGED";
    public static final String PERFORMANCE_FEEDBACK = "PERFORMANCE_FEEDBACK";
    public static final String PERFORMANCE_FLAGGED = "PERFORMANCE_FLAGGED";
    public static final String PATIENT_ASSIGNED = "PATIENT_ASSIGNED";
    public static final String THERAPIST_ASSIGNED = "THERAPIST_ASSIGNED";

    private static final int MAX_PAGE = 100;

    private final NotificationRepository repository;

    public NotificationService(NotificationRepository repository) {
        this.repository = repository;
    }

    /** No-op when there is no recipient (e.g. a patient without an assigned therapist). */
    @Transactional
    public void notify(User recipient, String type, String title, String message, String link,
                       String entityType, Long entityId) {
        if (recipient == null) return;
        Notification n = new Notification();
        n.setRecipient(recipient);
        n.setType(type);
        n.setTitle(title.length() > 200 ? title.substring(0, 199) + "…" : title);
        n.setMessage(message == null ? null : message.length() > 1000 ? message.substring(0, 999) + "…" : message);
        n.setLink(link);
        n.setEntityType(entityType);
        n.setEntityId(entityId);
        repository.save(n);
    }

    @Transactional(readOnly = true)
    public List<NotificationResponse> list(Long userId, boolean unreadOnly, int limit) {
        PageRequest page = PageRequest.of(0, Math.max(1, Math.min(limit, MAX_PAGE)));
        List<Notification> rows = unreadOnly
                ? repository.findByRecipientIdAndReadAtIsNullOrderByCreatedAtDescIdDesc(userId, page)
                : repository.findByRecipientIdOrderByCreatedAtDescIdDesc(userId, page);
        return rows.stream().map(NotificationService::toResponse).toList();
    }

    @Transactional(readOnly = true)
    public UnreadCount unreadCount(Long userId) {
        return new UnreadCount(repository.countByRecipientIdAndReadAtIsNull(userId));
    }

    /** Only the recipient can mark a notification; anyone else gets 404. */
    @Transactional
    public NotificationResponse markRead(Long userId, Long notificationId, boolean read) {
        Notification n = repository.findByIdAndRecipientId(notificationId, userId)
                .orElseThrow(() -> ApiException.notFound("Notification not found: " + notificationId));
        n.setReadAt(read ? (n.getReadAt() == null ? LocalDateTime.now() : n.getReadAt()) : null);
        return toResponse(n);
    }

    @Transactional
    public UnreadCount markAllRead(Long userId) {
        repository.markAllRead(userId, LocalDateTime.now());
        return new UnreadCount(0);
    }

    private static NotificationResponse toResponse(Notification n) {
        return new NotificationResponse(n.getId(), n.getType(), n.getTitle(), n.getMessage(), n.getLink(),
                n.getEntityType(), n.getEntityId(), n.getReadAt() != null, n.getReadAt(), n.getCreatedAt());
    }
}
