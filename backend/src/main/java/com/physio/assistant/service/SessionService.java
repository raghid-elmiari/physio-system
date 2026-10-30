package com.physio.assistant.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.physio.assistant.dto.EventDtos.IngestEventRequest;
import com.physio.assistant.dto.SessionDtos.*;
import com.physio.assistant.entity.*;
import com.physio.assistant.exception.ApiException;
import com.physio.assistant.repository.*;
import com.physio.assistant.security.AuthPrincipal;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

@Service
public class SessionService {

    private static final Logger log = LoggerFactory.getLogger(SessionService.class);

    private final SessionRepository sessionRepository;
    private final SessionEventRepository eventRepository;
    private final SessionReportRepository reportRepository;
    private final ExerciseRepository exerciseRepository;
    private final ExerciseAssignmentRepository assignmentRepository;
    private final DeviceRepository deviceRepository;
    private final UserRepository userRepository;
    private final SimpMessagingTemplate messagingTemplate;
    private final ObjectMapper objectMapper;
    private final int staleAfterHours;

    public SessionService(
            SessionRepository sessionRepository,
            SessionEventRepository eventRepository,
            SessionReportRepository reportRepository,
            ExerciseRepository exerciseRepository,
            ExerciseAssignmentRepository assignmentRepository,
            DeviceRepository deviceRepository,
            UserRepository userRepository,
            SimpMessagingTemplate messagingTemplate,
            ObjectMapper objectMapper,
            @Value("${app.sessions.stale-after-hours}") int staleAfterHours
    ) {
        this.sessionRepository = sessionRepository;
        this.eventRepository = eventRepository;
        this.reportRepository = reportRepository;
        this.exerciseRepository = exerciseRepository;
        this.assignmentRepository = assignmentRepository;
        this.deviceRepository = deviceRepository;
        this.userRepository = userRepository;
        this.messagingTemplate = messagingTemplate;
        this.objectMapper = objectMapper;
        this.staleAfterHours = staleAfterHours;
    }

    // ---------------------------------------------------------------- patient-facing

    @Transactional
    public SessionResponse startSession(Long userId, StartSessionRequest req) {
        if (req.clientSessionId() != null) {
            Optional<Session> existing = sessionRepository.findByUserIdAndClientSessionId(userId, req.clientSessionId());
            if (existing.isPresent()) return toResponse(existing.get()); // retried request
        }
        User user = userRepository.findById(userId).orElseThrow(() -> ApiException.unauthorized("Unknown user"));
        Exercise exercise = requireExercise(req.exerciseId());
        ExerciseAssignment assignment = resolveAssignment(userId, req.assignmentId(), exercise);

        Session session = new Session();
        session.setUser(user);
        session.setExercise(exercise);
        session.setAssignment(assignment);
        session.setClientSessionId(req.clientSessionId());
        session.setRoundsRequested(firstNonNull(req.roundsRequested(),
                assignment == null ? null : assignment.getTargetReps(), exercise.getDefaultReps(), 10));
        if (req.deviceId() != null) {
            deviceRepository.findByDeviceId(req.deviceId()).ifPresent(session::setDevice);
        }
        return toResponse(sessionRepository.save(session));
    }

    @Transactional(readOnly = true)
    public SessionResponse getSession(AuthPrincipal viewer, Long sessionId) {
        return toResponse(requireViewable(viewer, sessionId));
    }

    /**
     * Finalises a session with the on-device summary. Idempotent: completing an already
     * completed session returns the existing report, so the client can safely retry after
     * a network failure.
     */
    @Transactional
    public SessionReportResponse completeSession(Long userId, Long sessionId, CompleteSessionRequest req) {
        Session session = requireOwned(userId, sessionId);
        if (session.getStatus() == Session.Status.COMPLETED) {
            return reportRepository.findBySessionId(sessionId).map(r -> toReport(session, r))
                    .orElseThrow(() -> ApiException.conflict("Session already completed"));
        }
        return finalise(session, req == null ? emptySummary() : req, LocalDateTime.now());
    }

    @Transactional
    public SessionResponse abortSession(Long userId, Long sessionId, Integer roundsCompleted) {
        Session session = requireOwned(userId, sessionId);
        if (session.getStatus() == Session.Status.IN_PROGRESS) {
            session.setStatus(Session.Status.ABORTED);
            session.setEndedAt(LocalDateTime.now());
            if (roundsCompleted != null && roundsCompleted >= 0) session.setRoundsCompleted(roundsCompleted);
            session.setDurationSeconds((int) Duration.between(session.getStartedAt(), session.getEndedAt()).getSeconds());
        }
        return toResponse(session);
    }

    /** Uploads a session that was started and finished while offline. Idempotent on clientSessionId. */
    @Transactional
    public SessionReportResponse syncOfflineSession(Long userId, SyncSessionRequest req) {
        Optional<Session> existing = sessionRepository.findByUserIdAndClientSessionId(userId, req.clientSessionId());
        if (existing.isPresent()) {
            Session s = existing.get();
            if (s.getStatus() == Session.Status.COMPLETED) {
                return reportRepository.findBySessionId(s.getId()).map(r -> toReport(s, r))
                        .orElseThrow(() -> ApiException.conflict("Session already completed"));
            }
            return finalise(s, req.summary(), req.endedAt() == null ? LocalDateTime.now() : req.endedAt());
        }
        User user = userRepository.findById(userId).orElseThrow(() -> ApiException.unauthorized("Unknown user"));
        Exercise exercise = requireExercise(req.exerciseId());
        if (req.startedAt().isAfter(LocalDateTime.now().plusMinutes(5))) {
            throw ApiException.badRequest("startedAt cannot be in the future");
        }
        Session session = new Session();
        session.setUser(user);
        session.setExercise(exercise);
        session.setAssignment(resolveAssignment(userId, req.assignmentId(), exercise));
        session.setClientSessionId(req.clientSessionId());
        session.setRoundsRequested(req.roundsRequested());
        session.setStartedAt(req.startedAt());
        session = sessionRepository.save(session);
        return finalise(session, req.summary(), req.endedAt() == null ? LocalDateTime.now() : req.endedAt());
    }

    @Transactional(readOnly = true)
    public List<SessionResponse> historyForUser(Long userId, Long exerciseId) {
        List<Session> sessions = exerciseId == null
                ? sessionRepository.findByUserIdOrderByStartedAtDesc(userId)
                : sessionRepository.findByUserIdAndExerciseIdOrderByStartedAtDesc(userId, exerciseId);
        return sessions.stream().map(this::toResponse).toList();
    }

    @Transactional(readOnly = true)
    public SessionReportResponse getReport(AuthPrincipal viewer, Long sessionId) {
        Session session = requireViewable(viewer, sessionId);
        SessionReport report = reportRepository.findBySessionId(sessionId)
                .orElseThrow(() -> ApiException.notFound("No report yet for session " + sessionId + " (has it completed?)"));
        return toReport(session, report);
    }

    @Transactional(readOnly = true)
    public List<SessionEventResponse> getEvents(AuthPrincipal viewer, Long sessionId) {
        requireViewable(viewer, sessionId);
        return eventRepository.findBySessionIdOrderBySequenceNoAsc(sessionId).stream()
                .map(e -> new SessionEventResponse(e.getSequenceNo(), e.getEventTimestamp(), e.getEventType(),
                        e.getErrorCode(), e.getJointName(),
                        e.getDeviationValue() == null ? null : e.getDeviationValue().doubleValue(),
                        e.getFeedbackMessage(), e.getRepNumber()))
                .toList();
    }

    // ---------------------------------------------------------------- device-facing (edge agent)

    // Called by an edge device (via /api/device/...) each time a posture-deviation event is
    // produced. Idempotent on (sessionId, eventUid) so a retried write after a network blip is a no-op.
    @Transactional
    public void ingestEvent(String deviceId, Long sessionId, IngestEventRequest req) {
        Session session = sessionRepository.findById(sessionId)
                .orElseThrow(() -> ApiException.notFound("Session not found: " + sessionId));
        // A device may only write to sessions that were started for that device.
        if (session.getDevice() == null || !session.getDevice().getDeviceId().equals(deviceId)) {
            throw ApiException.forbidden("Session " + sessionId + " is not bound to this device");
        }
        if (eventRepository.existsBySessionIdAndEventUid(sessionId, req.eventUid())) {
            return; // duplicate delivery — silently accepted
        }
        if (session.getStatus() != Session.Status.IN_PROGRESS) {
            throw ApiException.conflict("Session " + sessionId + " is not in progress");
        }

        SessionEvent event = new SessionEvent();
        event.setSession(session);
        event.setEventUid(req.eventUid());
        event.setSequenceNo(req.sequenceNo());
        event.setEventTimestamp(req.eventTimestamp());
        event.setJointName(req.jointName());
        event.setDeviationValue(req.deviationValue());
        event.setFeedbackMessage(req.feedbackMessage());
        event.setEventType("DEVIATION");
        if (req.source() != null) {
            try {
                event.setSource(SessionEvent.Source.valueOf(req.source()));
            } catch (IllegalArgumentException e) {
                throw ApiException.badRequest("Unknown event source: " + req.source());
            }
        }
        eventRepository.save(event);

        // Push to any subscribed client (WebSocketConfig).
        if (event.getFeedbackMessage() != null) {
            messagingTemplate.convertAndSend("/topic/sessions/" + sessionId + "/feedback", event.getFeedbackMessage());
        }
    }

    // ---------------------------------------------------------------- housekeeping

    /** Sessions abandoned mid-way (app closed, phone died) are closed as ABORTED. */
    @Scheduled(fixedDelayString = "PT15M", initialDelayString = "PT1M")
    @Transactional
    public void abortStaleSessions() {
        int n = sessionRepository.abortStale(LocalDateTime.now().minusHours(staleAfterHours), LocalDateTime.now());
        if (n > 0) log.info("Marked {} stale IN_PROGRESS session(s) as ABORTED", n);
    }

    // ---------------------------------------------------------------- access control helpers

    public Session requireOwned(Long userId, Long sessionId) {
        Session session = sessionRepository.findById(sessionId)
                .orElseThrow(() -> ApiException.notFound("Session not found: " + sessionId));
        // 404 rather than 403 so the existence of other users' sessions is not revealed.
        if (!session.getUser().getId().equals(userId)) throw ApiException.notFound("Session not found: " + sessionId);
        return session;
    }

    /** Owner, the owner's therapist, or an admin may view a session. */
    private Session requireViewable(AuthPrincipal viewer, Long sessionId) {
        Session session = sessionRepository.findById(sessionId)
                .orElseThrow(() -> ApiException.notFound("Session not found: " + sessionId));
        User owner = session.getUser();
        boolean allowed = owner.getId().equals(viewer.userId())
                || "ADMIN".equals(viewer.role())
                || ("THERAPIST".equals(viewer.role()) && owner.getTherapist() != null
                    && owner.getTherapist().getId().equals(viewer.userId()));
        if (!allowed) throw ApiException.notFound("Session not found: " + sessionId);
        return session;
    }

    private Exercise requireExercise(Long exerciseId) {
        return exerciseRepository.findById(exerciseId)
                .filter(Exercise::isActive)
                .orElseThrow(() -> ApiException.notFound("Exercise not found: " + exerciseId));
    }

    private ExerciseAssignment resolveAssignment(Long userId, Long assignmentId, Exercise exercise) {
        if (assignmentId == null) return null;
        ExerciseAssignment a = assignmentRepository.findById(assignmentId)
                .filter(x -> x.getPatient().getId().equals(userId))
                .orElseThrow(() -> ApiException.notFound("Assignment not found: " + assignmentId));
        if (!a.getExercise().getId().equals(exercise.getId())) {
            throw ApiException.badRequest("Assignment " + assignmentId + " is for a different exercise");
        }
        return a;
    }

    // ---------------------------------------------------------------- reporting

    private SessionReportResponse finalise(Session session, CompleteSessionRequest req, LocalDateTime endedAt) {
        int reps = req.roundsCompleted() == null ? 0 : req.roundsCompleted();
        Integer correct = req.correctReps();
        if (correct != null && correct > reps) {
            throw ApiException.badRequest("correctReps cannot exceed roundsCompleted");
        }
        int duration = req.durationSeconds() != null ? req.durationSeconds()
                : (int) Math.max(0, Duration.between(session.getStartedAt(), endedAt).getSeconds());

        session.setRoundsCompleted(reps);
        session.setCorrectReps(correct);
        session.setDurationSeconds(duration);
        session.setStatus(Session.Status.COMPLETED);
        session.setEndedAt(endedAt);

        saveClientEvents(session, req.events());

        BigDecimal accuracy;
        if (correct != null) {
            // On-device rule-based evaluation: share of counted reps performed without a persistent error.
            accuracy = reps == 0 ? BigDecimal.ZERO
                    : BigDecimal.valueOf(correct * 100.0 / reps).setScale(2, RoundingMode.HALF_UP);
        } else {
            // Legacy (edge-device) path: proportion of logged deviation events within 5 degrees.
            List<SessionEvent> events = eventRepository.findBySessionIdOrderBySequenceNoAsc(session.getId());
            List<SessionEvent> measured = events.stream().filter(e -> e.getDeviationValue() != null).toList();
            long clean = measured.stream().filter(e -> e.getDeviationValue().compareTo(new BigDecimal("5.0")) <= 0).count();
            accuracy = measured.isEmpty() ? BigDecimal.ZERO
                    : BigDecimal.valueOf(clean * 100.0 / measured.size()).setScale(2, RoundingMode.HALF_UP);
        }

        SessionReport report = new SessionReport();
        report.setSession(session);
        report.setAccuracyPct(accuracy);
        report.setTotalReps(reps);
        report.setCorrectReps(correct);
        report.setDurationSeconds(duration);
        report.setCommonMistakesJson(toJson(mistakes(req.errorCounts(), req.errorMessages())));
        report.setMetricsJson(req.metrics() == null || req.metrics().isNull() ? null : req.metrics().toString());
        reportRepository.save(report);
        return toReport(session, report);
    }

    private void saveClientEvents(Session session, List<ClientEvent> events) {
        if (events == null || events.isEmpty()) return;
        Set<String> seen = eventRepository.findBySessionIdOrderBySequenceNoAsc(session.getId()).stream()
                .map(SessionEvent::getEventUid).collect(Collectors.toCollection(HashSet::new));
        List<SessionEvent> toSave = new ArrayList<>();
        for (ClientEvent ce : events) {
            if (!seen.add(ce.eventUid())) continue;
            SessionEvent e = new SessionEvent();
            e.setSession(session);
            e.setEventUid(ce.eventUid());
            e.setSequenceNo(ce.sequenceNo());
            e.setEventTimestamp(ce.eventTimestamp());
            e.setEventType(ce.eventType());
            e.setErrorCode(ce.errorCode());
            e.setJointName(ce.jointName());
            if (ce.value() != null && Double.isFinite(ce.value())) {
                double clamped = Math.max(-9999.99, Math.min(9999.99, ce.value()));
                e.setDeviationValue(BigDecimal.valueOf(clamped).setScale(2, RoundingMode.HALF_UP));
            }
            e.setFeedbackMessage(ce.message());
            e.setRepNumber(ce.repNumber());
            e.setSource(SessionEvent.Source.ON_DEVICE_RULES);
            toSave.add(e);
        }
        eventRepository.saveAll(toSave);
    }

    private List<MistakeSummary> mistakes(Map<String, Integer> counts, Map<String, String> messages) {
        if (counts == null) return List.of();
        return counts.entrySet().stream()
                .filter(e -> e.getKey() != null && e.getValue() != null && e.getValue() > 0)
                .map(e -> new MistakeSummary(e.getKey(),
                        messages == null ? null : messages.get(e.getKey()), e.getValue()))
                .sorted(Comparator.comparingInt(MistakeSummary::count).reversed())
                .limit(20)
                .toList();
    }

    private SessionReportResponse toReport(Session s, SessionReport r) {
        List<MistakeSummary> mistakes = List.of();
        if (r.getCommonMistakesJson() != null) {
            try {
                mistakes = objectMapper.readValue(r.getCommonMistakesJson(), new TypeReference<>() {});
            } catch (JsonProcessingException ignored) {
                // leave empty: the raw JSON is still returned below
            }
        }
        return new SessionReportResponse(s.getId(), s.getExercise().getId(), s.getExercise().getName(),
                r.getAccuracyPct().toString(), r.getTotalReps(), r.getCorrectReps(), s.getRoundsRequested(),
                r.getDurationSeconds(), mistakes, r.getCommonMistakesJson(),
                parse(r.getMetricsJson()), s.getStartedAt(), r.getGeneratedAt());
    }

    public SessionResponse toResponse(Session s) {
        return new SessionResponse(
                s.getId(), s.getExercise().getId(), s.getExercise().getName(),
                s.getAssignment() == null ? null : s.getAssignment().getId(),
                s.getStatus().name(), s.getRoundsRequested(), s.getRoundsCompleted(), s.getCorrectReps(),
                s.getDurationSeconds(), s.getClientSessionId(), s.getStartedAt(), s.getEndedAt()
        );
    }

    private String toJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            return null;
        }
    }

    private com.fasterxml.jackson.databind.JsonNode parse(String json) {
        if (json == null) return null;
        try {
            return objectMapper.readTree(json);
        } catch (JsonProcessingException e) {
            return null;
        }
    }

    private static CompleteSessionRequest emptySummary() {
        return new CompleteSessionRequest(0, null, null, null, null, null, null);
    }

    @SafeVarargs
    private static <T> T firstNonNull(T... values) {
        for (T v : values) if (v != null) return v;
        return null;
    }
}
