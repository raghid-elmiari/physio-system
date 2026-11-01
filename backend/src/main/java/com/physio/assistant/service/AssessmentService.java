package com.physio.assistant.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.physio.assistant.dto.ClinicalDtos.*;
import com.physio.assistant.entity.*;
import com.physio.assistant.exception.ApiException;
import com.physio.assistant.repository.AuditLogRepository;
import com.physio.assistant.repository.PatientAssessmentRepository;
import com.physio.assistant.repository.UserRepository;
import com.physio.assistant.security.AuthPrincipal;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.*;

/**
 * Physical assessments and the patient's baseline.
 *
 * <ul>
 *   <li>The patient drafts (IN_PROGRESS) and submits. Submission goes to PENDING_REVIEW when a
 *       physiotherapist is assigned, otherwise SUBMITTED until an administrator assigns one.</li>
 *   <li>Only the patient's assigned physiotherapist approves or requests a revision. Patients
 *       can never approve their own assessment.</li>
 *   <li>Therapist corrections are new THERAPIST_MEASURED rows; the original value is kept and
 *       marked superseded. Every step is written to the audit log.</li>
 *   <li>An APPROVED assessment is immutable. The baseline is the patient's approved INITIAL
 *       assessment; later assessments are separate FOLLOW_UP records.</li>
 * </ul>
 * Submitting an assessment does not clear the patient to exercise: prescriptions are approved separately.
 */
@Service
public class AssessmentService {

    private static final Set<PatientAssessment.Status> OPEN = EnumSet.of(PatientAssessment.Status.IN_PROGRESS,
            PatientAssessment.Status.SUBMITTED, PatientAssessment.Status.PENDING_REVIEW, PatientAssessment.Status.REVISION_REQUESTED);
    static final Set<PatientAssessment.Status> AWAITING_REVIEW = EnumSet.of(PatientAssessment.Status.SUBMITTED,
            PatientAssessment.Status.PENDING_REVIEW);

    private final PatientAssessmentRepository assessmentRepository;
    private final UserRepository userRepository;
    private final AuditLogRepository auditLogRepository;
    private final ExerciseService exerciseService;
    private final PatientAccessPolicy accessPolicy;
    private final AuditService auditService;
    private final NotificationService notificationService;
    private final ObjectMapper objectMapper;

    public AssessmentService(PatientAssessmentRepository assessmentRepository, UserRepository userRepository,
                             AuditLogRepository auditLogRepository, ExerciseService exerciseService,
                             PatientAccessPolicy accessPolicy, AuditService auditService,
                             NotificationService notificationService, ObjectMapper objectMapper) {
        this.assessmentRepository = assessmentRepository;
        this.userRepository = userRepository;
        this.auditLogRepository = auditLogRepository;
        this.exerciseService = exerciseService;
        this.accessPolicy = accessPolicy;
        this.auditService = auditService;
        this.notificationService = notificationService;
        this.objectMapper = objectMapper;
    }

    // ================================================================= patient

    @Transactional(readOnly = true)
    public AssessmentStatusResponse statusFor(Long patientId) {
        List<PatientAssessment> all = assessmentRepository.findByPatientIdOrderByCreatedAtDesc(patientId);
        Long baselineId = baseline(patientId).map(PatientAssessment::getId).orElse(null);
        Optional<PatientAssessment> open = all.stream().filter(a -> OPEN.contains(a.getStatus())).findFirst();
        String nextType = baselineId == null ? "INITIAL" : "FOLLOW_UP";
        if (all.isEmpty()) return new AssessmentStatusResponse("NOT_STARTED", null, null, nextType, true);
        PatientAssessment current = open.orElse(all.get(0));
        return new AssessmentStatusResponse(current.getStatus().name(), current.getId(), baselineId, nextType, open.isEmpty());
    }

    @Transactional(readOnly = true)
    public List<AssessmentSummary> listForPatient(Long patientId) {
        Long baselineId = baseline(patientId).map(PatientAssessment::getId).orElse(null);
        return assessmentRepository.findByPatientIdOrderByCreatedAtDesc(patientId).stream()
                .map(a -> toSummary(a, baselineId)).toList();
    }

    @Transactional(readOnly = true)
    public AssessmentResponse getOwn(Long patientId, Long assessmentId) {
        return toResponse(requireOwn(patientId, assessmentId));
    }

    /** Starts a draft. The type is INITIAL until a baseline is approved, then FOLLOW_UP. */
    @Transactional
    public AssessmentResponse create(Long patientId, CreateAssessmentRequest req) {
        User patient = userRepository.findById(patientId).orElseThrow(() -> ApiException.unauthorized("Unknown user"));
        List<PatientAssessment> open = assessmentRepository.findByPatientIdAndStatusIn(patientId, OPEN);
        if (!open.isEmpty()) {
            throw ApiException.conflict("You already have an assessment in progress (#" + open.get(0).getId() + ")");
        }
        boolean hasBaseline = baseline(patientId).isPresent();
        PatientAssessment.Type type = hasBaseline ? PatientAssessment.Type.FOLLOW_UP : PatientAssessment.Type.INITIAL;
        if (req != null && "INITIAL".equals(req.type()) && hasBaseline) {
            throw ApiException.conflict("Your baseline is already approved. New measurements are recorded as a follow-up assessment.");
        }
        PatientAssessment a = new PatientAssessment();
        a.setPatient(patient);
        a.setAssessmentType(type);
        a.setStatus(PatientAssessment.Status.IN_PROGRESS);
        a.setCreatedBy(patient);
        a = assessmentRepository.save(a);
        return toResponse(a);
    }

    /** Replaces the patient-reported content of an editable assessment. */
    @Transactional
    public AssessmentResponse save(AuthPrincipal patientPrincipal, Long assessmentId, SaveAssessmentRequest req) {
        PatientAssessment a = requireOwn(patientPrincipal.userId(), assessmentId);
        if (!a.isEditableByPatient()) {
            throw ApiException.conflict(a.getStatus() == PatientAssessment.Status.APPROVED
                    ? "Approved assessments cannot be changed"
                    : "This assessment is with your physiotherapist and cannot be changed now");
        }
        Map<String, Object> before = a.getStatus() == PatientAssessment.Status.REVISION_REQUESTED ? snapshot(a) : null;
        a.setPatientNotes(blankToNull(req.patientNotes()));
        a.getItems().clear();
        assessmentRepository.flush();
        fillItems(a, req.items(), MeasurementSource.PATIENT_REPORTED, a.getPatient());
        if (before != null) {
            // Revisions after a therapist's request are documented with the previous values.
            auditService.record(patientPrincipal, "ASSESSMENT_REVISED", "ASSESSMENT", a.getId(), a.getPatient(),
                    "Patient revised assessment #" + a.getId(), Map.of("previous", before));
        }
        return toResponse(a);
    }

    @Transactional
    public AssessmentResponse submit(AuthPrincipal patientPrincipal, Long assessmentId) {
        PatientAssessment a = requireOwn(patientPrincipal.userId(), assessmentId);
        if (!a.isEditableByPatient()) throw ApiException.conflict("This assessment has already been submitted");
        boolean hasValues = a.getItems().stream().anyMatch(i -> !i.getMeasurements().isEmpty());
        if (!hasValues) throw ApiException.badRequest("Add at least one measurement before submitting");
        PatientAssessment.Status from = a.getStatus();
        User therapist = a.getPatient().getTherapist();
        a.setStatus(therapist != null ? PatientAssessment.Status.PENDING_REVIEW : PatientAssessment.Status.SUBMITTED);
        a.setSubmittedAt(LocalDateTime.now());
        auditService.record(patientPrincipal, from == PatientAssessment.Status.REVISION_REQUESTED ? "ASSESSMENT_RESUBMITTED" : "ASSESSMENT_SUBMITTED",
                "ASSESSMENT", a.getId(), a.getPatient(), "Patient submitted assessment #" + a.getId(), null);
        notifyTherapistOfSubmission(a);
        return toResponse(a);
    }

    /** Called when an administrator assigns a therapist: waiting submissions move into their review queue. */
    @Transactional
    public void routeWaitingSubmissions(User patient) {
        if (patient.getTherapist() == null) return;
        for (PatientAssessment a : assessmentRepository.findByPatientIdAndStatusIn(patient.getId(), AWAITING_REVIEW)) {
            a.setStatus(PatientAssessment.Status.PENDING_REVIEW);
            notifyTherapistOfSubmission(a);
        }
    }

    // ================================================================= therapist

    @Transactional(readOnly = true)
    public List<AssessmentSummary> listForStaff(AuthPrincipal staff, Long patientId) {
        accessPolicy.requireAccessiblePatient(staff, patientId);
        return listForPatient(patientId);
    }

    /** Submitted assessments across the caller's caseload, oldest first. */
    @Transactional(readOnly = true)
    public List<AssessmentSummary> pendingReviews(AuthPrincipal staff) {
        List<Long> ids = accessPolicy.caseloadIds(staff);
        if (ids.isEmpty()) return List.of();
        return assessmentRepository.findByPatientIdInAndStatusInOrderBySubmittedAtAsc(ids, AWAITING_REVIEW).stream()
                .map(a -> toSummary(a, null)).toList();
    }

    @Transactional(readOnly = true)
    public AssessmentResponse getForStaff(AuthPrincipal staff, Long assessmentId) {
        return toResponse(requireForStaff(staff, assessmentId));
    }

    /** A physiotherapist records an assessment they measured; it is ready for their review at once. */
    @Transactional
    public AssessmentResponse createByTherapist(AuthPrincipal therapist, Long patientId, TherapistAssessmentRequest req) {
        User patient = accessPolicy.requireTreatingTherapist(therapist, patientId);
        if (!assessmentRepository.findByPatientIdAndStatusIn(patientId, OPEN).isEmpty()) {
            throw ApiException.conflict("The patient has an assessment in progress; review or complete that one first");
        }
        boolean hasBaseline = baseline(patientId).isPresent();
        PatientAssessment.Type type = PatientAssessment.Type.valueOf(req.type());
        if (type == PatientAssessment.Type.INITIAL && hasBaseline) {
            throw ApiException.conflict("A baseline is already approved; record a follow-up assessment instead");
        }
        User author = userRepository.getReferenceById(therapist.userId());
        PatientAssessment a = new PatientAssessment();
        a.setPatient(patient);
        a.setAssessmentType(type);
        a.setCreatedBy(author);
        a.setPatientNotes(blankToNull(req.notes()));
        a.setStatus(PatientAssessment.Status.PENDING_REVIEW);
        a.setSubmittedAt(LocalDateTime.now());
        a = assessmentRepository.save(a);
        fillItems(a, req.items(), MeasurementSource.THERAPIST_MEASURED, author);
        auditService.record(therapist, "ASSESSMENT_RECORDED", "ASSESSMENT", a.getId(), patient,
                "Therapist recorded " + type + " assessment #" + a.getId(), null);
        return toResponse(a);
    }

    /** Correction or addition by the treating therapist while the assessment awaits review. */
    @Transactional
    public AssessmentResponse correct(AuthPrincipal therapist, Long assessmentId, CorrectionRequest req) {
        PatientAssessment a = requireForStaff(therapist, assessmentId);
        accessPolicy.requireTreatingTherapist(therapist, a.getPatient().getId());
        if (!a.isAwaitingReview()) throw ApiException.conflict("Only submitted assessments awaiting review can be corrected");
        Exercise exercise = exerciseService.requireIncludingArchived(req.exerciseId());
        ExerciseParameter param = exerciseService.requireParameterOf(exercise, req.parameterId());
        AssessmentItem item = a.getItems().stream().filter(i -> i.getExercise().getId().equals(exercise.getId())).findFirst()
                .orElseGet(() -> {
                    AssessmentItem created = new AssessmentItem();
                    created.setAssessment(a);
                    created.setExercise(exercise);
                    a.getItems().add(created);
                    return created;
                });
        Measurement original = null;
        if (req.correctsMeasurementId() != null) {
            original = item.getMeasurements().stream().filter(m -> m.getId().equals(req.correctsMeasurementId())).findFirst()
                    .orElseThrow(() -> ApiException.badRequest("Measurement " + req.correctsMeasurementId() + " is not part of this exercise in the assessment"));
            if (original.isSuperseded()) throw ApiException.conflict("That value was already corrected; correct the newest value instead");
            if (!original.getParameter().getId().equals(param.getId())) throw ApiException.badRequest("A correction must be for the same parameter");
        } else if (item.getMeasurements().stream().anyMatch(m -> !m.isSuperseded() && m.getParameter().getId().equals(param.getId()))) {
            throw ApiException.badRequest("This parameter already has a value; correct that value instead");
        }
        MeasurementRules.Check check = MeasurementRules.validate(param, req.value(), req.valueMin(), req.valueMax(), "measurement");
        User author = userRepository.getReferenceById(therapist.userId());
        Measurement m = PerformanceService.newMeasurement(param, req.value(), req.valueMin(), req.valueMax(),
                MeasurementSource.THERAPIST_MEASURED, author, req.note(), LocalDateTime.now());
        m.setFlagged(check.flagged());
        m.setFlagReason(check.reason());
        m.setAssessmentItem(item);
        m.setCorrects(original);
        if (original != null) original.setSuperseded(true);
        item.getMeasurements().add(m);
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("parameter", param.getLabel());
        if (original != null) details.put("previous", valueMap(original));
        details.put("corrected", Map.of("value", String.valueOf(req.value()), "min", String.valueOf(req.valueMin()),
                "max", String.valueOf(req.valueMax()), "unit", param.getUnit()));
        details.put("note", req.note());
        auditService.record(therapist, original != null ? "ASSESSMENT_MEASUREMENT_CORRECTED" : "ASSESSMENT_MEASUREMENT_ADDED",
                "ASSESSMENT", a.getId(), a.getPatient(),
                (original != null ? "Corrected " : "Added ") + param.getLabel() + " on assessment #" + a.getId(), details);
        assessmentRepository.flush();
        return toResponse(a);
    }

    @Transactional
    public AssessmentResponse approve(AuthPrincipal therapist, Long assessmentId, ReviewCommentRequest req) {
        PatientAssessment a = requireForStaff(therapist, assessmentId);
        accessPolicy.requireTreatingTherapist(therapist, a.getPatient().getId());
        if (!a.isAwaitingReview()) throw ApiException.conflict("Only submitted assessments awaiting review can be approved");
        if (a.getItems().stream().allMatch(i -> i.getMeasurements().isEmpty())) {
            throw ApiException.badRequest("The assessment has no measurements to approve");
        }
        LocalDateTime now = LocalDateTime.now();
        a.setStatus(PatientAssessment.Status.APPROVED);
        a.setReviewedBy(userRepository.getReferenceById(therapist.userId()));
        a.setReviewedAt(now);
        a.setApprovedAt(now);
        a.setReviewComment(req == null ? null : blankToNull(req.comment()));
        auditService.record(therapist, "ASSESSMENT_APPROVED", "ASSESSMENT", a.getId(), a.getPatient(),
                "Approved " + a.getAssessmentType() + " assessment #" + a.getId()
                        + (a.getAssessmentType() == PatientAssessment.Type.INITIAL ? " as baseline" : ""),
                a.getReviewComment() == null ? null : Map.of("comment", a.getReviewComment()));
        notificationService.notify(a.getPatient(), NotificationService.ASSESSMENT_APPROVED,
                "Your assessment was reviewed and approved",
                a.getReviewComment(), "/assessment/" + a.getId(), "ASSESSMENT", a.getId());
        return toResponse(a);
    }

    @Transactional
    public AssessmentResponse requestRevision(AuthPrincipal therapist, Long assessmentId, RequiredCommentRequest req) {
        PatientAssessment a = requireForStaff(therapist, assessmentId);
        accessPolicy.requireTreatingTherapist(therapist, a.getPatient().getId());
        if (!a.isAwaitingReview()) throw ApiException.conflict("Only submitted assessments awaiting review can be sent back");
        a.setStatus(PatientAssessment.Status.REVISION_REQUESTED);
        a.setReviewedBy(userRepository.getReferenceById(therapist.userId()));
        a.setReviewedAt(LocalDateTime.now());
        a.setReviewComment(req.comment().trim());
        auditService.record(therapist, "ASSESSMENT_REVISION_REQUESTED", "ASSESSMENT", a.getId(), a.getPatient(),
                "Requested a revision of assessment #" + a.getId(), Map.of("comment", a.getReviewComment()));
        notificationService.notify(a.getPatient(), NotificationService.ASSESSMENT_REVISION_REQUESTED,
                "Your physiotherapist asked you to revise your assessment", a.getReviewComment(),
                "/assessment/" + a.getId(), "ASSESSMENT", a.getId());
        return toResponse(a);
    }

    /** The audit trail of one assessment (submissions, revisions, corrections, approval). */
    @Transactional(readOnly = true)
    public List<HistoryEntry> history(AuthPrincipal viewer, Long assessmentId) {
        PatientAssessment a = viewer.isTherapist() ? requireForStaff(viewer, assessmentId) : requireOwn(viewer.userId(), assessmentId);
        return auditLogRepository.findByEntityTypeAndEntityIdOrderByCreatedAtAscIdAsc("ASSESSMENT", a.getId()).stream()
                .map(log -> new HistoryEntry(log.getId(), log.getAction(), log.getSummary(),
                        log.getActor() == null ? "System" : log.getActor().getFullName(), log.getActorRole(),
                        readJson(log.getDetails()), log.getCreatedAt()))
                .toList();
    }

    // ================================================================= baseline

    /** The approved baseline: the most recently approved INITIAL assessment. */
    @Transactional(readOnly = true)
    public Optional<PatientAssessment> baseline(Long patientId) {
        List<PatientAssessment> approved = assessmentRepository.findByPatientIdAndStatusOrderByApprovedAtAsc(
                patientId, PatientAssessment.Status.APPROVED);
        PatientAssessment result = null;
        for (PatientAssessment a : approved) {
            if (a.getAssessmentType() == PatientAssessment.Type.INITIAL) result = a;
        }
        return Optional.ofNullable(result);
    }

    // ================================================================= helpers

    private void fillItems(PatientAssessment a, List<AssessmentItemInput> items, MeasurementSource source, User recorder) {
        Set<Long> exercises = new HashSet<>();
        LocalDateTime now = LocalDateTime.now();
        for (AssessmentItemInput in : items) {
            if (!exercises.add(in.exerciseId())) throw ApiException.badRequest("Each exercise can appear only once");
            Exercise exercise = exerciseService.require(in.exerciseId());
            AssessmentItem item = new AssessmentItem();
            item.setAssessment(a);
            item.setExercise(exercise);
            item.setPainLevel(in.painLevel());
            item.setDifficultyRating(in.difficultyRating());
            item.setIndependent(in.independent());
            item.setLimitationNotes(blankToNull(in.limitationNotes()));
            Set<Long> params = new HashSet<>();
            for (MeasurementInput m : in.measurements() == null ? List.<MeasurementInput>of() : in.measurements()) {
                if (!params.add(m.parameterId())) throw ApiException.badRequest("Each parameter can be measured once per exercise");
                ExerciseParameter param = exerciseService.requireParameterOf(exercise, m.parameterId());
                if (!param.isActive()) throw ApiException.badRequest(param.getLabel() + " is no longer measured");
                MeasurementRules.Check check = MeasurementRules.validate(param, m.value(), m.valueMin(), m.valueMax(), "measurement");
                Measurement row = PerformanceService.newMeasurement(param, m.value(), m.valueMin(), m.valueMax(), source, recorder, m.note(), now);
                row.setFlagged(check.flagged());
                row.setFlagReason(check.reason());
                row.setAssessmentItem(item);
                item.getMeasurements().add(row);
            }
            a.getItems().add(item);
        }
    }

    private void notifyTherapistOfSubmission(PatientAssessment a) {
        User therapist = a.getPatient().getTherapist();
        notificationService.notify(therapist, NotificationService.ASSESSMENT_SUBMITTED,
                a.getPatient().getFullName() + " submitted an assessment for review",
                (a.getAssessmentType() == PatientAssessment.Type.INITIAL ? "Initial (baseline)" : "Follow-up") + " assessment, "
                        + a.getItems().size() + " exercise(s).",
                "/therapist/assessments/" + a.getId(), "ASSESSMENT", a.getId());
    }

    private PatientAssessment requireOwn(Long patientId, Long assessmentId) {
        return assessmentRepository.findById(assessmentId)
                .filter(a -> a.getPatient().getId().equals(patientId))
                .orElseThrow(() -> ApiException.notFound("Assessment not found: " + assessmentId));
    }

    private PatientAssessment requireForStaff(AuthPrincipal staff, Long assessmentId) {
        return assessmentRepository.findById(assessmentId)
                .filter(a -> accessPolicy.canAccess(staff, a.getPatient()))
                .orElseThrow(() -> ApiException.notFound("Assessment not found: " + assessmentId));
    }

    private Map<String, Object> snapshot(PatientAssessment a) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("notes", a.getPatientNotes());
        m.put("items", a.getItems().stream().map(i -> {
            Map<String, Object> im = new LinkedHashMap<>();
            im.put("exercise", i.getExercise().getName());
            im.put("pain", i.getPainLevel());
            im.put("difficulty", i.getDifficultyRating());
            im.put("independent", i.getIndependent());
            im.put("measurements", i.getMeasurements().stream().map(AssessmentService::valueMap).toList());
            return im;
        }).toList());
        return m;
    }

    private static Map<String, Object> valueMap(Measurement m) {
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("label", m.getLabel());
        v.put("value", m.getValue());
        v.put("min", m.getValueMin());
        v.put("max", m.getValueMax());
        v.put("unit", m.getUnit());
        v.put("source", m.getSource().name());
        return v;
    }

    private AssessmentSummary toSummary(PatientAssessment a, Long baselineId) {
        int flagged = (int) a.getItems().stream().flatMap(i -> i.getMeasurements().stream())
                .filter(m -> m.isFlagged() && !m.isSuperseded()).count();
        return new AssessmentSummary(a.getId(), a.getPatient().getId(), a.getPatient().getFullName(),
                a.getAssessmentType().name(), a.getStatus().name(), a.getSubmittedAt(), a.getApprovedAt(),
                a.getReviewedBy() == null ? null : a.getReviewedBy().getFullName(), a.getItems().size(), flagged,
                a.getId().equals(baselineId), a.getCreatedAt());
    }

    private AssessmentResponse toResponse(PatientAssessment a) {
        Long baselineId = baseline(a.getPatient().getId()).map(PatientAssessment::getId).orElse(null);
        List<AssessmentItemResponse> items = a.getItems().stream().map(i -> new AssessmentItemResponse(
                i.getId(), i.getExercise().getId(), i.getExercise().getName(), i.getPainLevel(), i.getDifficultyRating(),
                i.getIndependent(), i.getLimitationNotes(),
                i.getMeasurements().stream().map(PerformanceService::toResponse).toList())).toList();
        return new AssessmentResponse(a.getId(), a.getPatient().getId(), a.getPatient().getFullName(),
                a.getAssessmentType().name(), a.getStatus().name(),
                a.getCreatedBy() == null ? null : a.getCreatedBy().getFullName(),
                a.getSupersedes() == null ? null : a.getSupersedes().getId(), a.getPatientNotes(),
                a.getSubmittedAt(), a.getReviewedBy() == null ? null : a.getReviewedBy().getFullName(),
                a.getReviewedAt(), a.getReviewComment(), a.getApprovedAt(), a.getCreatedAt(), a.getUpdatedAt(),
                a.isEditableByPatient(), a.getId().equals(baselineId), items);
    }

    private com.fasterxml.jackson.databind.JsonNode readJson(String json) {
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
}
