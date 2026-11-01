package com.physio.assistant.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.physio.assistant.dto.ExerciseDtos.*;
import com.physio.assistant.entity.Exercise;
import com.physio.assistant.entity.ExerciseAssignment;
import com.physio.assistant.entity.ExerciseParameter;
import com.physio.assistant.entity.PrescriptionTarget;
import com.physio.assistant.entity.Session;
import com.physio.assistant.entity.User;
import com.physio.assistant.exception.ApiException;
import com.physio.assistant.repository.ExerciseAssignmentRepository;
import com.physio.assistant.repository.ExerciseParameterRepository;
import com.physio.assistant.repository.ExerciseRepository;
import com.physio.assistant.repository.SessionRepository;
import com.physio.assistant.security.AuthPrincipal;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.stream.Collectors;

/**
 * The exercise library (global definitions and their measurement parameters) and exercise
 * prescriptions (patient-specific doses and targets).
 *
 * The two are kept separate on purpose: a prescription copies everything patient-specific
 * (instructions, targets with their label and unit) when it is created, so editing a library
 * exercise never changes what a patient was prescribed.
 */
@Service
public class ExerciseService {

    /** frontend src/core/exercises/referenceDtw.js */
    public static final String REFERENCE_ANALYZER = "reference_dtw";
    private static final int MAX_REFERENCE_JSON_CHARS = 300_000;

    /** Statuses shown in the patient's program. Only ACTIVE (or APPROVED once due) can be performed. */
    static final Set<ExerciseAssignment.Status> PATIENT_PROGRAM_STATUSES = EnumSet.of(
            ExerciseAssignment.Status.PENDING_APPROVAL, ExerciseAssignment.Status.APPROVED,
            ExerciseAssignment.Status.ACTIVE, ExerciseAssignment.Status.PAUSED);

    private final ExerciseRepository exerciseRepository;
    private final ExerciseAssignmentRepository assignmentRepository;
    private final ExerciseParameterRepository parameterRepository;
    private final SessionRepository sessionRepository;
    private final com.physio.assistant.repository.UserRepository userRepository;
    private final AuditService auditService;
    private final ObjectMapper objectMapper;

    public ExerciseService(ExerciseRepository exerciseRepository, ExerciseAssignmentRepository assignmentRepository,
                           ExerciseParameterRepository parameterRepository, SessionRepository sessionRepository,
                           com.physio.assistant.repository.UserRepository userRepository,
                           AuditService auditService, ObjectMapper objectMapper) {
        this.userRepository = userRepository;
        this.exerciseRepository = exerciseRepository;
        this.assignmentRepository = assignmentRepository;
        this.parameterRepository = parameterRepository;
        this.sessionRepository = sessionRepository;
        this.auditService = auditService;
        this.objectMapper = objectMapper;
    }

    // ================================================================= library (read)

    @Transactional(readOnly = true)
    public List<ExerciseResponse> listActive() {
        return toResponses(exerciseRepository.findByActiveTrueOrderByNameAsc());
    }

    /** Library management view: optionally includes archived exercises. */
    @Transactional(readOnly = true)
    public List<ExerciseResponse> listLibrary(boolean includeArchived) {
        List<Exercise> exercises = includeArchived
                ? exerciseRepository.findAll().stream().sorted(Comparator.comparing(Exercise::getName, String.CASE_INSENSITIVE_ORDER)).toList()
                : exerciseRepository.findByActiveTrueOrderByNameAsc();
        return toResponses(exercises);
    }

    /** Exercises the patient can include in a physical assessment (active, with assessment parameters). */
    @Transactional(readOnly = true)
    public List<ExerciseResponse> assessableExercises() {
        return listActive().stream()
                .filter(e -> e.parameters().stream().anyMatch(p -> p.active() && p.assessmentEnabled()))
                .map(e -> withParameters(e, e.parameters().stream().filter(p -> p.active() && p.assessmentEnabled()).toList()))
                .toList();
    }

    @Transactional(readOnly = true)
    public ExerciseResponse get(Long id) {
        return toResponse(require(id));
    }

    /** An active (not archived) exercise. */
    public Exercise require(Long id) {
        return exerciseRepository.findById(id)
                .filter(Exercise::isActive)
                .orElseThrow(() -> ApiException.notFound("Exercise not found: " + id));
    }

    public Exercise requireIncludingArchived(Long id) {
        return exerciseRepository.findById(id).orElseThrow(() -> ApiException.notFound("Exercise not found: " + id));
    }

    public ExerciseParameter requireParameterOf(Exercise exercise, Long parameterId) {
        return parameterRepository.findById(parameterId)
                .filter(p -> p.getExercise().getId().equals(exercise.getId()))
                .orElseThrow(() -> ApiException.badRequest("Parameter " + parameterId + " does not belong to " + exercise.getName()));
    }

    // ================================================================= library (manage)

    @Transactional
    public ExerciseResponse createLibraryExercise(AuthPrincipal actor, LibraryExerciseRequest req) {
        Exercise e = new Exercise();
        e.setCreatedBy(userRepository.findById(actor.userId()).orElseThrow(() -> ApiException.unauthorized("Unknown user")));
        applyLibraryFields(e, req);
        e = exerciseRepository.save(e);
        applyParameters(e, req.parameters() == null ? List.of() : req.parameters());
        auditService.record(actor, "EXERCISE_CREATED", "EXERCISE", e.getId(), null,
                "Created library exercise \"" + e.getName() + "\"", null);
        return toResponse(e);
    }

    /** Edits the global definition only. Existing prescriptions keep their own copied instructions and targets. */
    @Transactional
    public ExerciseResponse updateLibraryExercise(AuthPrincipal actor, Long id, LibraryExerciseRequest req) {
        Exercise e = requireIncludingArchived(id);
        Map<String, Object> before = Map.of("name", e.getName(), "defaultReps", e.getDefaultReps());
        applyLibraryFields(e, req);
        if (req.parameters() != null) applyParameters(e, req.parameters());
        auditService.record(actor, "EXERCISE_UPDATED", "EXERCISE", e.getId(), null,
                "Edited library exercise \"" + e.getName() + "\"", Map.of("before", before));
        return toResponse(e);
    }

    /** Archiving hides the exercise from the library and from new prescriptions; nothing is deleted. */
    @Transactional
    public ExerciseResponse setArchived(AuthPrincipal actor, Long id, boolean archived) {
        Exercise e = requireIncludingArchived(id);
        e.setActive(!archived);
        e.setArchivedAt(archived ? LocalDateTime.now() : null);
        auditService.record(actor, archived ? "EXERCISE_ARCHIVED" : "EXERCISE_RESTORED", "EXERCISE", e.getId(), null,
                (archived ? "Archived" : "Restored") + " library exercise \"" + e.getName() + "\"", null);
        return toResponse(e);
    }

    private void applyLibraryFields(Exercise e, LibraryExerciseRequest req) {
        e.setName(req.name().trim());
        e.setDescription(blankToNull(req.description()));
        e.setInstructions(blankToNull(req.instructions()));
        e.setCameraSetup(blankToNull(req.cameraSetup()));
        e.setBodyRegion(blankToNull(req.bodyRegion()));
        e.setCategory(blankToNull(req.category()));
        e.setDifficultyLevel(req.difficultyLevel() == null || req.difficultyLevel().isBlank()
                ? null : ExerciseAssignment.Difficulty.valueOf(req.difficultyLevel()));
        e.setDefaultReps(req.defaultReps());
    }

    /**
     * Replaces the exercise's parameter set. Existing parameters keep their identity (and their
     * type, unit and range shape, which recorded values depend on); parameters left out are
     * archived, never deleted.
     */
    private void applyParameters(Exercise exercise, List<ParameterRequest> requested) {
        List<ExerciseParameter> existing = exercise.getId() == null ? List.of()
                : parameterRepository.findByExerciseIdOrderBySortOrderAscIdAsc(exercise.getId());
        Map<Long, ExerciseParameter> byId = existing.stream().collect(Collectors.toMap(ExerciseParameter::getId, p -> p));
        Map<String, ExerciseParameter> byCode = existing.stream().collect(Collectors.toMap(ExerciseParameter::getCode, p -> p));
        Set<String> seenCodes = new HashSet<>();
        Set<Long> kept = new HashSet<>();
        int order = 1;
        for (ParameterRequest r : requested) {
            if (!seenCodes.add(r.code())) throw ApiException.badRequest("Parameter code \"" + r.code() + "\" is used twice");
            validateParameterRanges(r);
            ExerciseParameter p = r.id() != null ? byId.get(r.id()) : byCode.get(r.code());
            if (r.id() != null && p == null) throw ApiException.badRequest("Parameter " + r.id() + " does not belong to this exercise");
            if (p == null) {
                p = new ExerciseParameter();
                p.setExercise(exercise);
                p.setCode(r.code());
                p.setMeasurementType(ExerciseParameter.MeasurementType.valueOf(r.measurementType()));
                p.setUnit(r.unit().trim());
                p.setRangeMeasurement(r.rangeMeasurement());
            } else {
                boolean shapeChanged = !p.getCode().equals(r.code())
                        || p.getMeasurementType() != ExerciseParameter.MeasurementType.valueOf(r.measurementType())
                        || !p.getUnit().equals(r.unit().trim())
                        || p.isRangeMeasurement() != r.rangeMeasurement();
                if (shapeChanged) {
                    throw ApiException.badRequest("\"" + p.getLabel() + "\": code, type, unit and range cannot change once created, "
                            + "because recorded values depend on them. Add a new parameter instead.");
                }
            }
            p.setLabel(r.label().trim());
            p.setMinValid(r.minValid());
            p.setMaxValid(r.maxValid());
            p.setNormalMin(r.normalMin());
            p.setNormalMax(r.normalMax());
            p.setHigherIsBetter(r.higherIsBetter() == null || r.higherIsBetter());
            p.setAssessmentEnabled(r.assessmentEnabled() == null || r.assessmentEnabled());
            p.setCvMetricKey(blankToNull(r.cvMetricKey()));
            p.setSortOrder(order++);
            p.setActive(true);
            p = parameterRepository.save(p);
            kept.add(p.getId());
        }
        for (ExerciseParameter p : existing) {
            if (!kept.contains(p.getId())) p.setActive(false);
        }
    }

    private static void validateParameterRanges(ParameterRequest r) {
        if (r.minValid() != null && r.maxValid() != null && r.minValid() > r.maxValid()) {
            throw ApiException.badRequest(r.label() + ": the lowest possible value is above the highest");
        }
        if (r.normalMin() != null && r.normalMax() != null && r.normalMin() > r.normalMax()) {
            throw ApiException.badRequest(r.label() + ": the expected range is inverted");
        }
        if ((r.minValid() != null && r.normalMin() != null && r.normalMin() < r.minValid())
                || (r.maxValid() != null && r.normalMax() != null && r.normalMax() > r.maxValid())) {
            throw ApiException.badRequest(r.label() + ": the expected range must lie within the possible values");
        }
    }

    // ================================================================= prescriptions

    /** The patient's program: prescriptions awaiting approval, approved, active or paused, not past their end date. */
    @Transactional(readOnly = true)
    public List<AssignmentResponse> assignmentsFor(Long patientId) {
        LocalDate today = LocalDate.now();
        return assignmentRepository.findByPatientIdAndStatusInOrderByCreatedAtDesc(patientId, PATIENT_PROGRAM_STATUSES).stream()
                .filter(a -> a.getEndDate() == null || !a.getEndDate().isBefore(today))
                .map(this::toResponse)
                .toList();
    }

    /** Every prescription the patient has had, including paused, discontinued and replaced ones. */
    @Transactional(readOnly = true)
    public List<AssignmentResponse> prescriptionHistoryFor(Long patientId) {
        return assignmentRepository.findByPatientIdOrderByCreatedAtDesc(patientId).stream().map(this::toResponse).toList();
    }

    /** New prescriptions always wait for the treating physiotherapist's approval. */
    @Transactional
    public ExerciseAssignment createAssignment(User patient, User therapist, CreateAssignmentRequest request) {
        ExerciseAssignment prescription = newPrescription(patient, therapist, request, null);
        prescription.changeStatus(ExerciseAssignment.Status.PENDING_APPROVAL);
        return assignmentRepository.save(prescription);
    }

    /**
     * Revises a prescription: the current one is marked REPLACED and a new version with the
     * requested dose and targets takes its place, so earlier sessions stay linked to what was
     * prescribed then.
     *
     * @param authorisedByTreatingTherapist the patient's own physiotherapist made the change, which
     *        is itself the clinical authorisation; otherwise (e.g. an administrator) the new
     *        version must be approved again before the patient can continue.
     */
    @Transactional
    public ExerciseAssignment revisePrescription(ExerciseAssignment current, User therapist, CreateAssignmentRequest request,
                                                 boolean authorisedByTreatingTherapist) {
        if (current.getStatus() == ExerciseAssignment.Status.REPLACED
                || current.getStatus() == ExerciseAssignment.Status.DISCONTINUED
                || current.getStatus() == ExerciseAssignment.Status.COMPLETED) {
            throw ApiException.conflict("Only current prescriptions (awaiting approval, approved, active or paused) can be edited");
        }
        if (!current.getExercise().getId().equals(request.exerciseId())) {
            throw ApiException.badRequest("A revision must keep the same exercise; prescribe a new exercise instead");
        }
        ExerciseAssignment revised = newPrescription(current.getPatient(), therapist, request, current);
        revised.setChangeReason(blankToNull(request.changeReason()));
        if (authorisedByTreatingTherapist && current.isApproved()) {
            revised.changeStatus(current.getStatus()); // a paused prescription stays paused after editing
            revised.setApprovedBy(therapist);
            revised.setApprovedAt(LocalDateTime.now());
            revised.setApprovalNote("Revised by the treating physiotherapist");
        } else {
            revised.changeStatus(ExerciseAssignment.Status.PENDING_APPROVAL);
        }
        current.changeStatus(ExerciseAssignment.Status.REPLACED);
        return assignmentRepository.save(revised);
    }

    /** Puts an approved prescription in force: ACTIVE now, or APPROVED until its start date. */
    @Transactional
    public void approve(ExerciseAssignment prescription, User approver, String note) {
        if (prescription.getStatus() != ExerciseAssignment.Status.PENDING_APPROVAL) {
            throw ApiException.conflict("Only prescriptions awaiting approval can be approved (current status: "
                    + prescription.getStatus() + ")");
        }
        if (!prescription.getExercise().isActive()) {
            throw ApiException.conflict("This exercise has been archived from the library; prescribe another one");
        }
        LocalDate today = LocalDate.now();
        if (prescription.getEndDate() != null && prescription.getEndDate().isBefore(today)) {
            throw ApiException.conflict("The prescription's end date has already passed; edit the dates first");
        }
        prescription.setApprovedBy(approver);
        prescription.setApprovedAt(LocalDateTime.now());
        prescription.setApprovalNote(blankToNull(note));
        boolean startsLater = prescription.getStartDate() != null && prescription.getStartDate().isAfter(today);
        prescription.changeStatus(startsLater ? ExerciseAssignment.Status.APPROVED : ExerciseAssignment.Status.ACTIVE);
    }

    /**
     * Null when the patient may perform this prescription today; otherwise the reason they may not.
     * An APPROVED prescription whose start date has arrived is performable (it becomes ACTIVE on first use).
     */
    public static String startBlockedReason(ExerciseAssignment a, LocalDate today) {
        String startsOn = a.getStartDate() == null ? null : a.getStartDate().format(DateTimeFormatter.ISO_LOCAL_DATE);
        return switch (a.getStatus()) {
            case PENDING_APPROVAL -> "Waiting for your physiotherapist to approve this exercise";
            case APPROVED, ACTIVE -> {
                if (a.getStartDate() != null && a.getStartDate().isAfter(today)) yield "Starts on " + startsOn;
                if (a.getEndDate() != null && a.getEndDate().isBefore(today)) yield "This prescription has ended";
                if (!a.isApproved()) yield "Waiting for your physiotherapist to approve this exercise";
                yield null;
            }
            case PAUSED -> "Paused by your physiotherapist";
            default -> "This prescription is no longer in force";
        };
    }

    /** Throws 409 unless the patient may perform this prescription today; promotes a due APPROVED one to ACTIVE. */
    @Transactional
    public void requirePerformable(ExerciseAssignment a) {
        String reason = startBlockedReason(a, LocalDate.now());
        if (reason != null) throw ApiException.conflict(reason);
        if (a.getStatus() == ExerciseAssignment.Status.APPROVED) a.changeStatus(ExerciseAssignment.Status.ACTIVE);
    }

    private ExerciseAssignment newPrescription(User patient, User therapist, CreateAssignmentRequest request,
                                               ExerciseAssignment previous) {
        if (request.startDate() != null && request.endDate() != null && request.endDate().isBefore(request.startDate())) {
            throw ApiException.badRequest("endDate cannot be before startDate");
        }
        Exercise exercise = require(request.exerciseId());
        ExerciseAssignment prescription = new ExerciseAssignment();
        prescription.setPatient(patient);
        prescription.setExercise(exercise);
        prescription.setAssignedBy(therapist);
        prescription.setTargetReps(request.targetReps());
        prescription.setSetsPerSession(request.setsPerSession() == null ? 1 : request.setsPerSession());
        prescription.setSessionsPerWeek(request.sessionsPerWeek());
        prescription.setDurationSeconds(request.durationSeconds());
        prescription.setRestSeconds(request.restSeconds());
        prescription.setStartDate(request.startDate());
        prescription.setEndDate(request.endDate());
        prescription.setDifficulty(request.difficulty() == null ? null : ExerciseAssignment.Difficulty.valueOf(request.difficulty()));
        prescription.setNotes(blankToNull(request.notes()));
        // Patient-specific copy: later edits to the library exercise do not change this prescription.
        prescription.setInstructions(request.instructions() != null ? blankToNull(request.instructions())
                : previous != null ? previous.getInstructions() : exercise.getInstructions());
        prescription.setSafetyInstructions(blankToNull(request.safetyInstructions()));
        prescription.setExpectedProgression(blankToNull(request.expectedProgression()));
        prescription.setPreviousAssignment(previous);
        applyTargets(prescription, exercise, request.targets());
        return prescription;
    }

    private void applyTargets(ExerciseAssignment prescription, Exercise exercise, List<TargetRequest> targets) {
        if (targets == null) return;
        Set<Long> seen = new HashSet<>();
        for (TargetRequest t : targets) {
            if (!seen.add(t.parameterId())) throw ApiException.badRequest("Each parameter can have only one target");
            ExerciseParameter p = requireParameterOf(exercise, t.parameterId());
            if (!p.isActive()) throw ApiException.badRequest(p.getLabel() + " has been archived; it cannot get a new target");
            MeasurementRules.validate(p, t.targetValue(), t.targetMin(), t.targetMax(), "target");
            PrescriptionTarget target = new PrescriptionTarget();
            target.setAssignment(prescription);
            target.setParameter(p);
            target.setTargetValue(t.targetValue());
            target.setTargetMin(t.targetMin());
            target.setTargetMax(t.targetMax());
            target.setLabel(p.getLabel());
            target.setUnit(p.getUnit());
            target.setNote(blankToNull(t.note()));
            prescription.getTargets().add(target);
        }
    }

    /** Creates an exercise analysed by matching the therapist's reference recording. */
    @Transactional
    public ExerciseResponse createReferenceExercise(ReferenceExerciseRequest req) {
        Exercise e = new Exercise();
        e.setAnalyzerKey(REFERENCE_ANALYZER);
        applyReference(e, req);
        return toResponse(exerciseRepository.save(e));
    }

    /** Replaces the details and reference of an exercise created from a reference recording. */
    @Transactional
    public ExerciseResponse updateReferenceExercise(Long id, ReferenceExerciseRequest req) {
        Exercise e = require(id);
        if (!REFERENCE_ANALYZER.equals(e.getAnalyzerKey())) {
            throw ApiException.badRequest("Only exercises created from a reference recording can be updated here");
        }
        applyReference(e, req);
        return toResponse(e);
    }

    private void applyReference(Exercise e, ReferenceExerciseRequest req) {
        JsonNode reference = req.analysisConfig().path("reference");
        if (!reference.path("reps").isArray() || reference.path("reps").isEmpty()
                || !reference.path("features").isArray() || reference.path("features").isEmpty()
                || !reference.path("primary").isTextual()) {
            throw ApiException.badRequest("analysisConfig.reference must contain primary, features and at least one rep");
        }
        String config;
        try {
            config = objectMapper.writeValueAsString(req.analysisConfig());
        } catch (Exception ex) {
            throw ApiException.badRequest("analysisConfig is not valid JSON");
        }
        if (config.length() > MAX_REFERENCE_JSON_CHARS) {
            throw ApiException.badRequest("The reference is too large; keep fewer or shorter repetitions");
        }
        e.setName(req.name().trim());
        e.setDescription(req.description());
        e.setInstructions(req.instructions());
        e.setCameraSetup(req.cameraSetup());
        e.setBodyRegion(req.bodyRegion());
        e.setDefaultReps(req.defaultReps());
        e.setAnalysisConfigJson(config);
    }

    // ================================================================= mapping

    public ExerciseResponse toResponse(Exercise e) {
        List<ParameterResponse> params = e.getId() == null ? List.of()
                : parameterRepository.findByExerciseIdOrderBySortOrderAscIdAsc(e.getId()).stream().map(ExerciseService::toResponse).toList();
        return toResponse(e, params);
    }

    private List<ExerciseResponse> toResponses(List<Exercise> exercises) {
        if (exercises.isEmpty()) return List.of();
        Map<Long, List<ParameterResponse>> params = new HashMap<>();
        exercises.forEach(e -> params.put(e.getId(), new ArrayList<>()));
        // One query for all parameters (archived ones are included so management screens can show them).
        parameterRepository.findByExerciseIdInOrderBySortOrderAscIdAsc(params.keySet())
                .forEach(p -> params.get(p.getExercise().getId()).add(toResponse(p)));
        return exercises.stream().map(e -> toResponse(e, params.get(e.getId()))).toList();
    }

    private ExerciseResponse toResponse(Exercise e, List<ParameterResponse> params) {
        return new ExerciseResponse(
                e.getId(), e.getName(), e.getDescription(), e.getInstructions(), e.getCameraSetup(),
                e.getBodyRegion(), e.getDefaultReps(), e.getAnalyzerKey(),
                e.getAnalyzerKey() != null && !e.getAnalyzerKey().isBlank(),
                parseJson(e.getAnalysisConfigJson()),
                e.getCategory(), e.getDifficultyLevel() == null ? null : e.getDifficultyLevel().name(),
                e.isActive(), params,
                e.getCreatedBy() == null ? null : e.getCreatedBy().getFullName(),
                e.getUpdatedAt());
    }

    private static ExerciseResponse withParameters(ExerciseResponse e, List<ParameterResponse> params) {
        return new ExerciseResponse(e.id(), e.name(), e.description(), e.instructions(), e.cameraSetup(), e.bodyRegion(),
                e.defaultReps(), e.analyzerKey(), e.cameraMonitoringSupported(), e.analysisConfig(), e.category(),
                e.difficultyLevel(), e.active(), params, e.createdBy(), e.updatedAt());
    }

    public static ParameterResponse toResponse(ExerciseParameter p) {
        return new ParameterResponse(p.getId(), p.getCode(), p.getLabel(), p.getMeasurementType().name(), p.getUnit(),
                p.isRangeMeasurement(), p.getMinValid(), p.getMaxValid(), p.getNormalMin(), p.getNormalMax(),
                p.isHigherIsBetter(), p.isAssessmentEnabled(), p.getCvMetricKey(), p.getSortOrder(), p.isActive());
    }

    public static TargetResponse toResponse(PrescriptionTarget t) {
        ExerciseParameter p = t.getParameter();
        return new TargetResponse(t.getId(), p.getId(), p.getCode(), t.getLabel(), t.getUnit(), p.getMeasurementType().name(),
                p.isRangeMeasurement(), p.isHigherIsBetter(), t.getTargetValue(), t.getTargetMin(), t.getTargetMax(), t.getNote());
    }

    public AssignmentResponse toResponse(ExerciseAssignment prescription) {
        User prescriber = prescription.getAssignedBy();
        User approver = prescription.getApprovedBy();
        long completedLastWeek = sessionRepository.countByAssignmentIdAndStatusAndStartedAtAfter(
                prescription.getId(), Session.Status.COMPLETED, LocalDateTime.now().minusDays(7));
        String blocked = startBlockedReason(prescription, LocalDate.now());
        return new AssignmentResponse(
                prescription.getId(), toResponse(prescription.getExercise()),
                prescription.getTargetReps(), prescription.getSetsPerSession(), prescription.getSessionsPerWeek(),
                prescription.getNotes(),
                prescriber == null ? null : prescriber.getFullName(),
                prescription.getCreatedAt(), completedLastWeek,
                prescription.getStatus().name(), prescription.getDurationSeconds(), prescription.getRestSeconds(),
                prescription.getStartDate(), prescription.getEndDate(),
                prescription.getDifficulty() == null ? null : prescription.getDifficulty().name(),
                prescription.getPreviousAssignment() == null ? null : prescription.getPreviousAssignment().getId(),
                prescription.getUpdatedAt(),
                prescription.getInstructions(), prescription.getSafetyInstructions(), prescription.getExpectedProgression(),
                prescription.getChangeReason(),
                approver == null ? null : approver.getFullName(), prescription.getApprovedAt(), prescription.getApprovalNote(),
                prescription.getTargets().stream().map(ExerciseService::toResponse).toList(),
                blocked == null, blocked);
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    JsonNode parseJson(String json) {
        if (json == null || json.isBlank()) return null;
        try {
            return objectMapper.readTree(json);
        } catch (Exception e) {
            return null;
        }
    }
}
