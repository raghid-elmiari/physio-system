package com.physio.assistant.controller;

import com.physio.assistant.dto.EventDtos.IngestEventRequest;
import com.physio.assistant.service.SessionService;
import jakarta.validation.Valid;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

/**
 * Ingestion endpoint the edge device (UNO Q agent) calls to push each posture-deviation
 * event for a live session. Protected by DeviceApiKeyFilter (device credentials, not user
 * JWT) — see SecurityConfig: /api/device/** requires ROLE_DEVICE. A device may only write
 * to sessions that were started with its deviceId.
 */
@RestController
@RequestMapping("/api/device/sessions")
public class DeviceEventController {

    private final SessionService sessionService;

    public DeviceEventController(SessionService sessionService) {
        this.sessionService = sessionService;
    }

    @PostMapping("/{sessionId}/events")
    public void ingest(Authentication auth, @PathVariable Long sessionId, @Valid @RequestBody IngestEventRequest request) {
        sessionService.ingestEvent(auth.getName(), sessionId, request);
    }
}
