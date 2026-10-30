package com.physio.assistant.controller;

import com.physio.assistant.dto.SessionDtos.*;
import com.physio.assistant.security.CurrentUser;
import com.physio.assistant.service.SessionService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/sessions")
public class SessionController {

    private final SessionService sessionService;

    public SessionController(SessionService sessionService) {
        this.sessionService = sessionService;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public SessionResponse start(Authentication auth, @Valid @RequestBody StartSessionRequest request) {
        return sessionService.startSession(CurrentUser.of(auth).userId(), request);
    }

    @GetMapping
    public List<SessionResponse> history(Authentication auth, @RequestParam(required = false) Long exerciseId) {
        return sessionService.historyForUser(CurrentUser.of(auth).userId(), exerciseId);
    }

    @GetMapping("/{id}")
    public SessionResponse get(Authentication auth, @PathVariable Long id) {
        return sessionService.getSession(CurrentUser.of(auth), id);
    }

    @PostMapping("/{id}/complete")
    public SessionReportResponse complete(Authentication auth, @PathVariable Long id,
                                          @Valid @RequestBody(required = false) CompleteSessionRequest body) {
        return sessionService.completeSession(CurrentUser.of(auth).userId(), id, body);
    }

    @PostMapping("/{id}/abort")
    public SessionResponse abort(Authentication auth, @PathVariable Long id,
                                 @RequestBody(required = false) Map<String, Integer> body) {
        Integer rounds = body == null ? null : body.get("roundsCompleted");
        return sessionService.abortSession(CurrentUser.of(auth).userId(), id, rounds);
    }

    /** Upload of a session recorded while offline (idempotent on clientSessionId). */
    @PostMapping("/sync")
    public SessionReportResponse sync(Authentication auth, @Valid @RequestBody SyncSessionRequest body) {
        return sessionService.syncOfflineSession(CurrentUser.of(auth).userId(), body);
    }

    @GetMapping("/{id}/report")
    public SessionReportResponse report(Authentication auth, @PathVariable Long id) {
        return sessionService.getReport(CurrentUser.of(auth), id);
    }

    @GetMapping("/{id}/events")
    public List<SessionEventResponse> events(Authentication auth, @PathVariable Long id) {
        return sessionService.getEvents(CurrentUser.of(auth), id);
    }
}
