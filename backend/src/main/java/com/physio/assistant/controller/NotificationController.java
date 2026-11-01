package com.physio.assistant.controller;

import com.physio.assistant.dto.NotificationDtos.*;
import com.physio.assistant.security.CurrentUser;
import com.physio.assistant.service.NotificationService;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/** The signed-in user's own notifications (any role). */
@RestController
@RequestMapping("/api/notifications")
public class NotificationController {

    private final NotificationService notificationService;

    public NotificationController(NotificationService notificationService) {
        this.notificationService = notificationService;
    }

    @GetMapping
    public List<NotificationResponse> list(Authentication auth,
                                           @RequestParam(defaultValue = "false") boolean unreadOnly,
                                           @RequestParam(defaultValue = "50") int limit) {
        return notificationService.list(CurrentUser.of(auth).userId(), unreadOnly, limit);
    }

    @GetMapping("/unread-count")
    public UnreadCount unreadCount(Authentication auth) {
        return notificationService.unreadCount(CurrentUser.of(auth).userId());
    }

    @PutMapping("/{id}/read")
    public NotificationResponse markRead(Authentication auth, @PathVariable Long id,
                                         @RequestBody(required = false) MarkReadRequest body) {
        boolean read = body == null || body.read() == null || body.read();
        return notificationService.markRead(CurrentUser.of(auth).userId(), id, read);
    }

    @PutMapping("/read-all")
    public UnreadCount markAllRead(Authentication auth) {
        return notificationService.markAllRead(CurrentUser.of(auth).userId());
    }
}
