package com.physio.assistant.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.physio.assistant.dto.ExerciseDtos.*;
import com.physio.assistant.entity.Exercise;
import com.physio.assistant.entity.ExerciseAssignment;
import com.physio.assistant.entity.Session;
import com.physio.assistant.entity.User;
import com.physio.assistant.exception.ApiException;
import com.physio.assistant.repository.ExerciseAssignmentRepository;
import com.physio.assistant.repository.ExerciseRepository;
import com.physio.assistant.repository.SessionRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

@Service
public class ExerciseService {

    /** frontend src/core/exercises/referenceDtw.js */
    public static final String REFERENCE_ANALYZER = "reference_dtw";
    private static final int MAX_REFERENCE_JSON_CHARS = 300_000;

    private final ExerciseRepository exerciseRepository;
    private final ExerciseAssignmentRepository assignmentRepository;
    private final SessionRepository sessionRepository;
    private final ObjectMapper objectMapper;

    public ExerciseService(ExerciseRepository exerciseRepository, ExerciseAssignmentRepository assignmentRepository,
                           SessionRepository sessionRepository, ObjectMapper objectMapper) {
        this.exerciseRepository = exerciseRepository;
        this.assignmentRepository = assignmentRepository;
        this.sessionRepository = sessionRepository;
        this.objectMapper = objectMapper;
    }

    @Transactional(readOnly = true)
    public List<ExerciseResponse> listActive() {
        return exerciseRepository.findByActiveTrueOrderByNameAsc().stream().map(this::toResponse).toList();
    }

    @Transactional(readOnly = true)
    public ExerciseResponse get(Long id) {
        return toResponse(require(id));
    }

    public Exercise require(Long id) {
        return exerciseRepository.findById(id)
                .filter(Exercise::isActive)
                .orElseThrow(() -> ApiException.notFound("Exercise not found: " + id));
    }

    /** The patient's current program: active prescriptions that have not reached their end date. */
    @Transactional(readOnly = true)
    public List<AssignmentResponse> assignmentsFor(Long patientId) {
        LocalDate today = LocalDate.now();
        return assignmentRepository.findByPatientIdAndActiveTrueOrderByCreatedAtDesc(patientId).stream()
                .filter(a -> a.getEndDate() == null || !a.getEndDate().isBefore(today))
                .map(this::toResponse)
                .toList();
    }

    /** Every prescription the patient has had, including paused, discontinued and replaced ones. */
    @Transactional(readOnly = true)
    public List<AssignmentResponse> prescriptionHistoryFor(Long patientId) {
        return assignmentRepository.findByPatientIdOrderByCreatedAtDesc(patientId).stream().map(this::toResponse).toList();
    }

    @Transactional
    public AssignmentResponse createAssignment(User patient, User therapist, CreateAssignmentRequest request) {
        return toResponse(assignmentRepository.save(newPrescription(patient, therapist, request, null)));
    }

    /**
     * Revises a prescription: the current one is marked REPLACED and a new version with the
     * requested dose takes its place, so earlier sessions stay linked to what was prescribed then.
     */
    @Transactional
    public AssignmentResponse revisePrescription(ExerciseAssignment current, User therapist, CreateAssignmentRequest request) {
        if (current.getStatus() == ExerciseAssignment.Status.REPLACED
                || current.getStatus() == ExerciseAssignment.Status.DISCONTINUED
                || current.getStatus() == ExerciseAssignment.Status.COMPLETED) {
            throw ApiException.conflict("Only active or paused prescriptions can be edited");
        }
        ExerciseAssignment revised = newPrescription(current.getPatient(), therapist, request, current);
        revised.changeStatus(current.getStatus()); // a paused prescription stays paused after editing
        current.changeStatus(ExerciseAssignment.Status.REPLACED);
        return toResponse(assignmentRepository.save(revised));
    }

    private ExerciseAssignment newPrescription(User patient, User therapist, CreateAssignmentRequest request,
                                               ExerciseAssignment previous) {
        if (request.startDate() != null && request.endDate() != null && request.endDate().isBefore(request.startDate())) {
            throw ApiException.badRequest("endDate cannot be before startDate");
        }
        ExerciseAssignment prescription = new ExerciseAssignment();
        prescription.setPatient(patient);
        prescription.setExercise(require(request.exerciseId()));
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
        prescription.setPreviousAssignment(previous);
        return prescription;
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

    public ExerciseResponse toResponse(Exercise e) {
        return new ExerciseResponse(
                e.getId(), e.getName(), e.getDescription(), e.getInstructions(), e.getCameraSetup(),
                e.getBodyRegion(), e.getDefaultReps(), e.getAnalyzerKey(),
                e.getAnalyzerKey() != null && !e.getAnalyzerKey().isBlank(),
                parseJson(e.getAnalysisConfigJson()));
    }

    public AssignmentResponse toResponse(ExerciseAssignment prescription) {
        User prescriber = prescription.getAssignedBy();
        long completedLastWeek = sessionRepository.countByAssignmentIdAndStatusAndStartedAtAfter(
                prescription.getId(), Session.Status.COMPLETED, LocalDateTime.now().minusDays(7));
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
                prescription.getUpdatedAt());
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
