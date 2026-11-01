package com.physio.assistant.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.physio.assistant.dto.ClinicalDtos.*;
import com.physio.assistant.entity.*;
import com.physio.assistant.exception.ApiException;
import com.physio.assistant.repository.ExerciseAssignmentRepository;
import com.physio.assistant.repository.ExerciseParameterRepository;
import com.physio.assistant.repository.ExercisePerformanceRepository;
import com.physio.assistant.repository.UserRepository;
import com.physio.assistant.security.AuthPrincipal;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.*;

/**
 * Exercise performance entries. Three sources write through the same model:
 * the patient (PATIENT_REPORTED), the physiotherapist (THERAPIST_MEASURED) and a computer
 * vision session (COMPUTER_VISION, via {@link #recordFromComputerVision}). None of them can
 * change a prescription or its targets.
 */
@Service
public class PerformanceService {

    static final int HIGH_PAIN = 7;

    private final ExercisePerformanceRepository performanceRepository;
    private final ExerciseAssignmentRepository assignmentRepository;
    private final ExerciseParameterRepository parameterRepository;
    private final UserRepository userRepository;
    private final ExerciseService exerciseService;
    private final PatientAccessPolicy accessPolicy;
    private final NotificationService notificationService;
    private final AuditService auditService;
    private final ObjectMapper objectMapper;

    public PerformanceService(ExercisePerformanceRepository performanceRepository, ExerciseAssignmentRepository assignmentRepository,
                              ExerciseParameterRepository parameterRepository, UserRepository userRepository,
                              ExerciseService exerciseService, PatientAccessPolicy accessPolicy,
                              NotificationService notificationService, AuditService auditService, ObjectMapper objectMapper) {
        this.performanceRepository = performanceRepository;
        this.assignmentRepository = assignmentRepository;
        this.parameterRepository = parameterRepository;
        this.userRepository = userRepository;
        this.exerciseService = exerciseService;
        this.accessPolicy = accessPolicy;
        this.notificationService = notificationService;
        this.auditService = auditService;
        this.objectMapper = objectMapper;
    }

    // ---------------------------------------------------------------- patient

    /** Patient-reported performance for one of their own prescriptions that is in force. */
    @Transactional
    public PerformanceResponse recordByPatient(Long patientId, PerformanceRequest req) {
        ExerciseAssignment a = assignmentRepository.findById(req.assignmentId())
                .filter(x -> x.getPatient().getId().equals(patientId))
                .orElseThrow(() -> ApiException.notFound("Prescription not found: " + req.assignmentId()));
        exerciseService.requirePerformable(a);
        ExercisePerformance p = build(a, req, MeasurementSource.PATIENT_REPORTED, a.getPatient());
        p = performanceRepository.save(p);
        if (p.isFlagged()) {
            notificationService.notify(a.getPatient().getTherapist(), NotificationService.PERFORMANCE_FLAGGED,
                    a.getPatient().getFullName() + ": " + a.getExercise().getName() + " needs your attention",
                    p.getFlagReason(), "/patients/" + patientId + "?tab=progress", "PERFORMANCE", p.getId());
        }
        return toResponse(p);
    }

    @Transactional(readOnly = true)
    public List<PerformanceResponse> forPatient(Long patientId) {
        return performanceRepository.findByPatientIdOrderByPerformedAtDesc(patientId).stream().map(this::toResponse).toList();
    }

    // ---------------------------------------------------------------- therapist

    @Transactional(readOnly = true)
    public List<PerformanceResponse> forPatientAsStaff(AuthPrincipal staff, Long patientId) {
        accessPolicy.requireAccessiblePatient(staff, patientId);
        return forPatient(patientId);
    }

    /** A measurement taken by the physiotherapist (e.g. goniometer during a clinic visit). */
    @Transactional
    public PerformanceResponse recordByTherapist(AuthPrincipal therapist, Long patientId, PerformanceRequest req) {
        User patient = accessPolicy.requireAccessiblePatient(therapist, patientId);
        ExerciseAssignment a = assignmentRepository.findById(req.assignmentId())
                .filter(x -> x.getPatient().getId().equals(patient.getId()))
                .orElseThrow(() -> ApiException.notFound("Prescription not found: " + req.assignmentId()));
        if (!a.isApproved()) throw ApiException.conflict("Approve the prescription before recording performance for it");
        ExercisePerformance p = performanceRepository.save(
                build(a, req, MeasurementSource.THERAPIST_MEASURED, userRepository.getReferenceById(therapist.userId())));
        auditService.record(therapist, "PERFORMANCE_RECORDED", "PERFORMANCE", p.getId(), patient,
                "Recorded therapist-measured performance for " + a.getExercise().getName(), null);
        return toResponse(p);
    }

    @Transactional
    public PerformanceResponse addFeedback(AuthPrincipal therapist, Long performanceId, FeedbackRequest req) {
        ExercisePerformance p = performanceRepository.findById(performanceId)
                .filter(x -> accessPolicy.canAccess(therapist, x.getPatient()))
                .orElseThrow(() -> ApiException.notFound("Performance entry not found: " + performanceId));
        String previous = p.getTherapistFeedback();
        p.setTherapistFeedback(req.feedback().trim());
        p.setFeedbackBy(userRepository.getReferenceById(therapist.userId()));
        p.setFeedbackAt(LocalDateTime.now());
        auditService.record(therapist, "PERFORMANCE_FEEDBACK", "PERFORMANCE", p.getId(), p.getPatient(),
                "Feedback on " + p.getAssignment().getExercise().getName(),
                previous == null ? null : Map.of("previousFeedback", previous));
        notificationService.notify(p.getPatient(), NotificationService.PERFORMANCE_FEEDBACK,
                "New feedback on " + p.getAssignment().getExercise().getName(), p.getTherapistFeedback(),
                "/progress", "PERFORMANCE", p.getId());
        return toResponse(p);
    }

    // ---------------------------------------------------------------- computer vision

    /**
     * Saves the result of an on-device computer vision session as a performance entry.
     *
     * Pipeline stages are kept apart in {@code cvDetails}: raw video and keypoints never leave
     * the device; the derived joint angles (analyzer metrics) and the movement classifications
     * (error counts) are stored; the final measurements are mapped to exercise parameters via
     * {@link ExerciseParameter#getCvMetricKey()}. Implausible automated values are dropped and
     * the entry flagged; an automated entry can never change targets or approvals.
     */
    @Transactional
    public void recordFromComputerVision(Session session, JsonNode metrics, Map<String, Integer> errorCounts) {
        if (performanceRepository.findBySessionId(session.getId()).isPresent()) return; // idempotent
        ExerciseAssignment a = session.getAssignment();
        ExercisePerformance p = new ExercisePerformance();
        p.setAssignment(a);
        p.setPatient(session.getUser());
        p.setSession(session);
        p.setSource(MeasurementSource.COMPUTER_VISION);
        p.setPerformedAt(session.getEndedAt() != null ? session.getEndedAt() : LocalDateTime.now());
        p.setRepsCompleted(session.getRoundsCompleted());
        p.setDurationSeconds(session.getDurationSeconds());

        List<String> flags = new ArrayList<>();
        for (ExerciseParameter param : parameterRepository.findByExerciseIdAndActiveTrueOrderBySortOrderAscIdAsc(a.getExercise().getId())) {
            Double v = null;
            if (param.getCvMetricKey() != null && metrics != null && metrics.path(param.getCvMetricKey()).isNumber()) {
                v = metrics.path(param.getCvMetricKey()).asDouble();
            } else if (param.getMeasurementType() == ExerciseParameter.MeasurementType.REPETITIONS && session.getRoundsCompleted() != null) {
                v = session.getRoundsCompleted().doubleValue();
            }
            if (v == null || param.isRangeMeasurement()) continue;
            try {
                MeasurementRules.Check check = MeasurementRules.validate(param, v, null, null, "measurement");
                Measurement m = newMeasurement(param, v, null, null, MeasurementSource.COMPUTER_VISION, null, null, p.getPerformedAt());
                m.setFlagged(check.flagged());
                m.setFlagReason(check.reason());
                m.setPerformance(p);
                p.getMeasurements().add(m);
                if (check.flagged()) flags.add(param.getLabel() + ": " + check.reason());
            } catch (ApiException implausible) {
                flags.add("Discarded implausible automated value — " + implausible.getMessage());
            }
        }
        if (!flags.isEmpty()) {
            p.setFlagged(true);
            p.setFlagReason(truncate(String.join("; ", flags), 500));
        }
        ObjectNode details = objectMapper.createObjectNode();
        details.put("pipeline", "On-device MediaPipe Pose Landmarker + rule/reference analyzer");
        details.put("analyzerKey", a.getExercise().getAnalyzerKey());
        details.put("rawVideo", "not stored (processed on the patient's device)");
        details.put("keypoints", "not stored");
        details.set("jointAngleMetrics", metrics == null ? objectMapper.nullNode() : metrics);
        details.set("classifications", objectMapper.valueToTree(errorCounts == null ? Map.of() : errorCounts));
        details.put("correctReps", session.getCorrectReps());
        details.put("clinicallyValidated", false);
        p.setCvDetails(details.toString());
        performanceRepository.save(p);
    }

    // ---------------------------------------------------------------- building

    private ExercisePerformance build(ExerciseAssignment a, PerformanceRequest req, MeasurementSource source, User recorder) {
        LocalDateTime now = LocalDateTime.now();
        LocalDateTime at = req.performedAt() == null ? now : req.performedAt();
        if (at.isAfter(now.plusMinutes(5))) throw ApiException.badRequest("performedAt cannot be in the future");
        if (at.isBefore(now.minusDays(30))) throw ApiException.badRequest("Entries older than 30 days cannot be added");
        boolean hasContent = req.repsCompleted() != null || req.setsCompleted() != null || req.durationSeconds() != null
                || (req.measurements() != null && !req.measurements().isEmpty());
        if (!hasContent) throw ApiException.badRequest("Enter at least repetitions, sets, duration or one measurement");

        ExercisePerformance p = new ExercisePerformance();
        p.setAssignment(a);
        p.setPatient(a.getPatient());
        p.setSource(source);
        p.setRecordedBy(recorder);
        p.setPerformedAt(at);
        p.setSetsCompleted(req.setsCompleted());
        p.setRepsCompleted(req.repsCompleted());
        p.setDurationSeconds(req.durationSeconds());
        p.setPainLevel(req.painLevel());
        p.setDifficultyRating(req.difficultyRating());
        p.setPatientNotes(blankToNull(req.notes()));

        List<String> flags = new ArrayList<>();
        if (req.painLevel() != null && req.painLevel() >= HIGH_PAIN) flags.add("High pain reported (" + req.painLevel() + "/10)");
        if (req.measurements() != null) {
            Set<Long> seen = new HashSet<>();
            for (MeasurementInput in : req.measurements()) {
                if (!seen.add(in.parameterId())) throw ApiException.badRequest("Each parameter can be measured once per entry");
                ExerciseParameter param = exerciseService.requireParameterOf(a.getExercise(), in.parameterId());
                MeasurementRules.Check check = MeasurementRules.validate(param, in.value(), in.valueMin(), in.valueMax(), "measurement");
                Measurement m = newMeasurement(param, in.value(), in.valueMin(), in.valueMax(), source, recorder, in.note(), at);
                m.setFlagged(check.flagged());
                m.setFlagReason(check.reason());
                m.setPerformance(p);
                p.getMeasurements().add(m);
                if (check.flagged()) flags.add(param.getLabel() + ": " + check.reason());
            }
        }
        if (!flags.isEmpty()) {
            p.setFlagged(true);
            p.setFlagReason(truncate(String.join("; ", flags), 500));
        }
        return p;
    }

    static Measurement newMeasurement(ExerciseParameter param, Double value, Double min, Double max, MeasurementSource source,
                                      User recorder, String note, LocalDateTime at) {
        Measurement m = new Measurement();
        m.setParameter(param);
        m.setSource(source);
        m.setValue(value);
        m.setValueMin(min);
        m.setValueMax(max);
        m.setUnit(param.getUnit());
        m.setLabel(param.getLabel());
        m.setRecordedBy(recorder);
        m.setNote(blankToNull(note));
        m.setMeasuredAt(at);
        return m;
    }

    // ---------------------------------------------------------------- mapping

    public PerformanceResponse toResponse(ExercisePerformance p) {
        ExerciseAssignment a = p.getAssignment();
        return new PerformanceResponse(p.getId(), a.getId(), a.getExercise().getId(), a.getExercise().getName(),
                p.getSession() == null ? null : p.getSession().getId(),
                p.getPerformedAt(), p.getSource().name(), p.getRecordedBy() == null ? null : p.getRecordedBy().getFullName(),
                p.getSetsCompleted(), p.getRepsCompleted(), p.getDurationSeconds(), p.getPainLevel(), p.getDifficultyRating(),
                p.getPatientNotes(), p.isFlagged(), p.getFlagReason(),
                p.getSource() == MeasurementSource.COMPUTER_VISION, parse(p.getCvDetails()),
                p.getTherapistFeedback(), p.getFeedbackBy() == null ? null : p.getFeedbackBy().getFullName(), p.getFeedbackAt(),
                p.getMeasurements().stream().map(PerformanceService::toResponse).toList(), p.getCreatedAt());
    }

    public static MeasurementResponse toResponse(Measurement m) {
        ExerciseParameter param = m.getParameter();
        Double diff = null;
        if (param.isRangeMeasurement() && param.getNormalMin() != null && param.getNormalMax() != null
                && m.getValueMin() != null && m.getValueMax() != null) {
            diff = (param.getNormalMax() - param.getNormalMin()) - (m.getValueMax() - m.getValueMin());
        } else if (!param.isRangeMeasurement() && param.getNormalMax() != null && m.getValue() != null
                && param.getMeasurementType() == ExerciseParameter.MeasurementType.ANGLE) {
            diff = param.getNormalMax() - m.getValue();
        }
        return new MeasurementResponse(m.getId(), param.getId(), param.getCode(), m.getLabel(), m.getUnit(),
                param.getMeasurementType().name(), param.isRangeMeasurement(), m.getValue(), m.getValueMin(), m.getValueMax(),
                m.comparableValue(), m.getSource().name(), m.getRecordedBy() == null ? null : m.getRecordedBy().getFullName(),
                m.getMeasuredAt(), m.getNote(), m.isFlagged(), m.getFlagReason(), m.isSuperseded(),
                m.getCorrects() == null ? null : m.getCorrects().getId(), param.getNormalMin(), param.getNormalMax(), diff);
    }

    private JsonNode parse(String json) {
        if (json == null) return null;
        try {
            return objectMapper.readTree(json);
        } catch (Exception e) {
            return null;
        }
    }

    private static String blankToNull(String v) {
        return v == null || v.isBlank() ? null : v.trim();
    }

    private static String truncate(String v, int max) {
        return v.length() <= max ? v : v.substring(0, max - 1) + "…";
    }
}
