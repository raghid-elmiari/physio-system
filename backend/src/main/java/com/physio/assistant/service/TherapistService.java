package com.physio.assistant.service;

import com.physio.assistant.dto.ExerciseDtos.*;
import com.physio.assistant.dto.ProgressDtos.ProgressResponse;
import com.physio.assistant.dto.SessionDtos.SessionResponse;
import com.physio.assistant.dto.UserDtos.*;
import com.physio.assistant.entity.ExerciseAssignment;
import com.physio.assistant.entity.Session;
import com.physio.assistant.entity.TherapistNote;
import com.physio.assistant.entity.User;
import com.physio.assistant.exception.ApiException;
import com.physio.assistant.repository.ExerciseAssignmentRepository;
import com.physio.assistant.repository.SessionRepository;
import com.physio.assistant.repository.TherapistNoteRepository;
import com.physio.assistant.repository.UserRepository;
import com.physio.assistant.security.AuthPrincipal;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Locale;

/**
 * Physiotherapist-side patient management: the caseload, patient profiles, account
 * status, exercise prescriptions and clinical notes. Every operation goes through
 * {@link PatientAccessPolicy}, so a physiotherapist only ever touches their own patients.
 */
@Service
public class TherapistService {

    private final UserRepository userRepository;
    private final ExerciseAssignmentRepository assignmentRepository;
    private final SessionRepository sessionRepository;
    private final TherapistNoteRepository noteRepository;
    private final ExerciseService exerciseService;
    private final SessionService sessionService;
    private final ProgressService progressService;
    private final AuthService authService;
    private final PatientAccessPolicy accessPolicy;
    private final PasswordEncoder passwordEncoder;
    private final AuditService auditService;
    private final NotificationService notificationService;

    public TherapistService(UserRepository userRepository, ExerciseAssignmentRepository assignmentRepository,
                            SessionRepository sessionRepository, TherapistNoteRepository noteRepository,
                            ExerciseService exerciseService, SessionService sessionService,
                            ProgressService progressService, AuthService authService,
                            PatientAccessPolicy accessPolicy, PasswordEncoder passwordEncoder,
                            AuditService auditService, NotificationService notificationService) {
        this.userRepository = userRepository;
        this.assignmentRepository = assignmentRepository;
        this.sessionRepository = sessionRepository;
        this.noteRepository = noteRepository;
        this.exerciseService = exerciseService;
        this.sessionService = sessionService;
        this.progressService = progressService;
        this.authService = authService;
        this.accessPolicy = accessPolicy;
        this.passwordEncoder = passwordEncoder;
        this.auditService = auditService;
        this.notificationService = notificationService;
    }

    // ---------------------------------------------------------------- caseload & profiles

    /**
     * @param search matches first name, last name, full name, email or the numeric patient ID
     * @param rehabStatus optional filter (ASSESSMENT, IN_TREATMENT, ON_HOLD, DISCHARGED)
     * @param accountStatus optional filter (ACTIVE, DISABLED)
     */
    @Transactional(readOnly = true)
    public List<PatientSummary> listPatients(AuthPrincipal therapist, String search, String rehabStatus, String accountStatus) {
        String query = search == null ? "" : search.trim().toLowerCase(Locale.ROOT);
        return accessPolicy.caseload(therapist).stream()
                .filter(patient -> query.isEmpty() || matchesSearch(patient, query))
                .filter(patient -> isBlank(rehabStatus) || patient.getRehabStatus() != null
                        && patient.getRehabStatus().name().equalsIgnoreCase(rehabStatus))
                .filter(patient -> isBlank(accountStatus) || patient.getStatus().name().equalsIgnoreCase(accountStatus))
                .map(this::toSummary)
                .toList();
    }

    /** Links an existing, unlinked PATIENT account (found by email) to this physiotherapist. */
    @Transactional
    public PatientSummary linkPatient(AuthPrincipal therapist, LinkPatientRequest request) {
        User patient = userRepository.findByEmailIgnoreCase(AuthService.normalizeEmail(request.email()))
                .filter(User::isPatient)
                .orElseThrow(() -> ApiException.notFound("No patient account with that email"));
        if (patient.getTherapist() != null && !patient.getTherapist().getId().equals(therapist.userId())) {
            throw ApiException.conflict("This patient is already linked to another therapist");
        }
        patient.setTherapist(userRepository.getReferenceById(therapist.userId()));
        auditService.record(therapist, "PATIENT_LINKED", "USER", patient.getId(), patient,
                "Therapist linked patient " + patient.getFullName() + " to their caseload", null);
        return toSummary(patient);
    }

    /** Creates a new patient account linked to this physiotherapist. The patient signs in with the temporary password. */
    @Transactional
    public PatientSummary createPatient(AuthPrincipal therapist, CreatePatientRequest request) {
        String email = AuthService.normalizeEmail(request.email());
        if (userRepository.existsByEmailIgnoreCase(email)) {
            throw ApiException.conflict("An account with this email already exists. Use \"Link existing patient\" instead.");
        }
        User patient = new User();
        patient.setFirstName(request.firstName().trim());
        patient.setLastName(request.lastName().trim());
        patient.setEmail(email);
        patient.setPasswordHash(passwordEncoder.encode(request.temporaryPassword()));
        patient.setRole(User.Role.PATIENT);
        patient.setTherapist(userRepository.getReferenceById(therapist.userId()));
        patient.setPhone(blankToNull(request.phone()));
        patient.setDateOfBirth(request.dateOfBirth());
        patient.setPrimaryCondition(blankToNull(request.primaryCondition()));
        patient.setRehabStatus(request.rehabStatus() == null
                ? User.RehabStatus.ASSESSMENT : User.RehabStatus.valueOf(request.rehabStatus()));
        patient = userRepository.save(patient);
        auditService.record(therapist, "PATIENT_CREATED", "USER", patient.getId(), patient,
                "Created patient account " + patient.getFullName(), null);
        return toSummary(patient);
    }

    @Transactional(readOnly = true)
    public PatientSummary getPatient(AuthPrincipal therapist, Long patientId) {
        return toSummary(accessPolicy.requireAccessiblePatient(therapist, patientId));
    }

    @Transactional
    public PatientSummary updatePatient(AuthPrincipal therapist, Long patientId, UpdatePatientRequest request) {
        User patient = accessPolicy.requireAccessiblePatient(therapist, patientId);
        patient.setFirstName(request.firstName().trim());
        patient.setLastName(request.lastName().trim());
        patient.setPhone(blankToNull(request.phone()));
        patient.setDateOfBirth(request.dateOfBirth());
        patient.setPrimaryCondition(blankToNull(request.primaryCondition()));
        patient.setRehabStatus(User.RehabStatus.valueOf(request.rehabStatus()));
        return toSummary(patient);
    }

    /** Deactivating signs the patient out everywhere; they cannot sign in again until reactivated. */
    @Transactional
    public PatientSummary changeAccountStatus(AuthPrincipal therapist, Long patientId, AccountStatusRequest request) {
        User patient = accessPolicy.requireAccessiblePatient(therapist, patientId);
        User.Status newStatus = User.Status.valueOf(request.status());
        User.Status previous = patient.getStatus();
        patient.setStatus(newStatus);
        if (newStatus == User.Status.DISABLED) authService.revokeAllSessions(patient.getId());
        if (previous != newStatus) {
            auditService.record(therapist, newStatus == User.Status.DISABLED ? "ACCOUNT_DEACTIVATED" : "ACCOUNT_ACTIVATED",
                    "USER", patient.getId(), patient, "Account of " + patient.getFullName() + " set to " + newStatus,
                    java.util.Map.of("from", previous.name(), "to", newStatus.name()));
        }
        return toSummary(patient);
    }

    @Transactional(readOnly = true)
    public List<SessionResponse> patientSessions(AuthPrincipal therapist, Long patientId) {
        accessPolicy.requireAccessiblePatient(therapist, patientId);
        return sessionService.historyForUser(patientId, null);
    }

    @Transactional(readOnly = true)
    public ProgressResponse patientProgress(AuthPrincipal therapist, Long patientId, int days) {
        accessPolicy.requireAccessiblePatient(therapist, patientId);
        return progressService.forUser(patientId, days);
    }

    // ---------------------------------------------------------------- prescriptions

    /**
     * @param includeHistory false: the current program only; true: every prescription, including
     *                       paused, discontinued, completed and replaced versions
     */
    @Transactional(readOnly = true)
    public List<AssignmentResponse> patientAssignments(AuthPrincipal therapist, Long patientId, boolean includeHistory) {
        accessPolicy.requireAccessiblePatient(therapist, patientId);
        return includeHistory ? exerciseService.prescriptionHistoryFor(patientId) : exerciseService.assignmentsFor(patientId);
    }

    /** Prescribing never clears the patient to start: the prescription waits for the treating therapist's approval. */
    @Transactional
    public AssignmentResponse assign(AuthPrincipal therapist, Long patientId, CreateAssignmentRequest request) {
        User patient = accessPolicy.requireAccessiblePatient(therapist, patientId);
        ExerciseAssignment created = exerciseService.createAssignment(patient, userRepository.getReferenceById(therapist.userId()), request);
        auditService.record(therapist, "PRESCRIPTION_CREATED", "PRESCRIPTION", created.getId(), patient,
                "Prescribed " + created.getExercise().getName() + " (awaiting approval)", prescriptionDetails(created));
        return exerciseService.toResponse(created);
    }

    @Transactional
    public AssignmentResponse revisePrescription(AuthPrincipal therapist, Long assignmentId, CreateAssignmentRequest request) {
        ExerciseAssignment current = requireAccessiblePrescription(therapist, assignmentId);
        boolean treating = accessPolicy.isTreatingTherapist(therapist, current.getPatient());
        ExerciseAssignment revised = exerciseService.revisePrescription(current,
                userRepository.getReferenceById(therapist.userId()), request, treating);
        java.util.Map<String, Object> details = new java.util.LinkedHashMap<>();
        details.put("before", prescriptionDetails(current));
        details.put("after", prescriptionDetails(revised));
        if (revised.getChangeReason() != null) details.put("reason", revised.getChangeReason());
        auditService.record(therapist, "PRESCRIPTION_REVISED", "PRESCRIPTION", revised.getId(), current.getPatient(),
                "Revised " + revised.getExercise().getName() + " (version replaces #" + current.getId() + ")", details);
        if (revised.isApproved()) {
            notificationService.notify(current.getPatient(), NotificationService.PRESCRIPTION_CHANGED,
                    "Your physiotherapist updated " + revised.getExercise().getName(),
                    revised.getChangeReason(), "/dashboard", "PRESCRIPTION", revised.getId());
        }
        return exerciseService.toResponse(revised);
    }

    /** Clinical clearance: only the patient's assigned physiotherapist may approve. */
    @Transactional
    public AssignmentResponse approvePrescription(AuthPrincipal therapist, Long assignmentId, ApprovePrescriptionRequest request) {
        ExerciseAssignment prescription = requireAccessiblePrescription(therapist, assignmentId);
        accessPolicy.requireTreatingTherapist(therapist, prescription.getPatient().getId());
        if (!Boolean.TRUE.equals(request.readinessConfirmed())) {
            throw ApiException.badRequest("Confirm that the patient is clinically ready for this exercise");
        }
        exerciseService.approve(prescription, userRepository.getReferenceById(therapist.userId()), request.note());
        auditService.record(therapist, "PRESCRIPTION_APPROVED", "PRESCRIPTION", prescription.getId(), prescription.getPatient(),
                "Approved " + prescription.getExercise().getName() + " (" + prescription.getStatus() + ")",
                request.note() == null ? null : java.util.Map.of("note", request.note()));
        notificationService.notify(prescription.getPatient(), NotificationService.PRESCRIPTION_APPROVED,
                prescription.getExercise().getName() + " was approved by your physiotherapist",
                prescription.getStatus() == ExerciseAssignment.Status.APPROVED && prescription.getStartDate() != null
                        ? "You can start on " + prescription.getStartDate() + "." : "You can start this exercise now.",
                "/dashboard", "PRESCRIPTION", prescription.getId());
        return exerciseService.toResponse(prescription);
    }

    /**
     * Pause, resume, complete or discontinue. Resuming only works for a paused (approved)
     * prescription: this endpoint can never put an unapproved prescription in force.
     */
    @Transactional
    public AssignmentResponse changePrescriptionStatus(AuthPrincipal therapist, Long assignmentId, AssignmentStatusRequest request) {
        ExerciseAssignment prescription = requireAccessiblePrescription(therapist, assignmentId);
        ExerciseAssignment.Status from = prescription.getStatus();
        ExerciseAssignment.Status to = ExerciseAssignment.Status.valueOf(request.status());
        if (from == ExerciseAssignment.Status.REPLACED) {
            throw ApiException.conflict("This prescription was replaced by a newer version; change that one instead");
        }
        if (from == ExerciseAssignment.Status.COMPLETED || from == ExerciseAssignment.Status.DISCONTINUED) {
            throw ApiException.conflict("This prescription has ended; prescribe the exercise again instead");
        }
        if (from == to) return exerciseService.toResponse(prescription);
        switch (to) {
            case ACTIVE -> {
                if (from != ExerciseAssignment.Status.PAUSED || !prescription.isApproved()) {
                    throw ApiException.conflict("Only a paused, approved prescription can be resumed; new prescriptions must be approved");
                }
                accessPolicy.requireTreatingTherapist(therapist, prescription.getPatient().getId());
            }
            case PAUSED -> {
                if (from == ExerciseAssignment.Status.PENDING_APPROVAL) {
                    throw ApiException.conflict("A prescription awaiting approval cannot be paused");
                }
            }
            default -> { /* COMPLETED / DISCONTINUED allowed from any current status */ }
        }
        prescription.changeStatus(to);
        auditService.record(therapist, "PRESCRIPTION_STATUS_CHANGED", "PRESCRIPTION", prescription.getId(), prescription.getPatient(),
                prescription.getExercise().getName() + ": " + from + " → " + to, java.util.Map.of("from", from.name(), "to", to.name()));
        return exerciseService.toResponse(prescription);
    }

    /** Kept for existing clients: DELETE discontinues the prescription (history is never deleted). */
    @Transactional
    public void deactivateAssignment(AuthPrincipal therapist, Long assignmentId) {
        ExerciseAssignment prescription = requireAccessiblePrescription(therapist, assignmentId);
        ExerciseAssignment.Status from = prescription.getStatus();
        if (from != ExerciseAssignment.Status.REPLACED && from != ExerciseAssignment.Status.DISCONTINUED
                && from != ExerciseAssignment.Status.COMPLETED) {
            prescription.changeStatus(ExerciseAssignment.Status.DISCONTINUED);
            auditService.record(therapist, "PRESCRIPTION_STATUS_CHANGED", "PRESCRIPTION", prescription.getId(), prescription.getPatient(),
                    prescription.getExercise().getName() + ": " + from + " → DISCONTINUED", java.util.Map.of("from", from.name(), "to", "DISCONTINUED"));
        }
    }

    private static java.util.Map<String, Object> prescriptionDetails(ExerciseAssignment a) {
        java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
        m.put("id", a.getId());
        m.put("exercise", a.getExercise().getName());
        m.put("targetReps", a.getTargetReps());
        m.put("setsPerSession", a.getSetsPerSession());
        m.put("sessionsPerWeek", a.getSessionsPerWeek());
        m.put("durationSeconds", a.getDurationSeconds());
        m.put("difficulty", a.getDifficulty() == null ? null : a.getDifficulty().name());
        m.put("status", a.getStatus().name());
        m.put("targets", a.getTargets().stream().map(t -> {
            java.util.Map<String, Object> tm = new java.util.LinkedHashMap<>();
            tm.put("label", t.getLabel());
            tm.put("value", t.getTargetValue());
            tm.put("min", t.getTargetMin());
            tm.put("max", t.getTargetMax());
            tm.put("unit", t.getUnit());
            return tm;
        }).toList());
        return m;
    }

    private ExerciseAssignment requireAccessiblePrescription(AuthPrincipal therapist, Long assignmentId) {
        ExerciseAssignment prescription = assignmentRepository.findById(assignmentId)
                .orElseThrow(() -> ApiException.notFound("Assignment not found: " + assignmentId));
        if (!accessPolicy.canAccess(therapist, prescription.getPatient())) {
            throw ApiException.notFound("Assignment not found: " + assignmentId);
        }
        return prescription;
    }

    // ---------------------------------------------------------------- clinical notes

    @Transactional(readOnly = true)
    public List<NoteResponse> patientNotes(AuthPrincipal therapist, Long patientId) {
        accessPolicy.requireAccessiblePatient(therapist, patientId);
        return noteRepository.findByPatientIdOrderByCreatedAtDesc(patientId).stream()
                .map(note -> toNoteResponse(note, therapist)).toList();
    }

    @Transactional
    public NoteResponse addNote(AuthPrincipal therapist, Long patientId, NoteRequest request) {
        User patient = accessPolicy.requireAccessiblePatient(therapist, patientId);
        TherapistNote note = new TherapistNote();
        note.setPatient(patient);
        note.setAuthor(userRepository.getReferenceById(therapist.userId()));
        note.setNoteText(request.text().trim());
        return toNoteResponse(noteRepository.save(note), therapist);
    }

    /** Only the author may delete a note. */
    @Transactional
    public void deleteNote(AuthPrincipal therapist, Long noteId) {
        TherapistNote note = noteRepository.findById(noteId)
                .filter(n -> accessPolicy.canAccess(therapist, n.getPatient()))
                .orElseThrow(() -> ApiException.notFound("Note not found: " + noteId));
        if (note.getAuthor() == null || !note.getAuthor().getId().equals(therapist.userId())) {
            throw ApiException.forbidden("Only the author can delete this note");
        }
        noteRepository.delete(note);
    }

    // ---------------------------------------------------------------- mapping

    private PatientSummary toSummary(User patient) {
        int activePrescriptions = assignmentRepository.findByPatientIdAndActiveTrueOrderByCreatedAtDesc(patient.getId()).size();
        var lastSessionAt = sessionRepository.findFirstByUserIdOrderByStartedAtDesc(patient.getId())
                .map(Session::getStartedAt).orElse(null);
        return new PatientSummary(
                patient.getId(), patient.getFirstName(), patient.getLastName(), patient.getEmail(),
                activePrescriptions, lastSessionAt,
                patient.getStatus().name(),
                patient.getRehabStatus() == null ? null : patient.getRehabStatus().name(),
                patient.getPhone(), patient.getDateOfBirth(), patient.getPrimaryCondition(),
                patient.getCreatedAt());
    }

    private static NoteResponse toNoteResponse(TherapistNote note, AuthPrincipal viewer) {
        User author = note.getAuthor();
        return new NoteResponse(note.getId(), note.getNoteText(),
                author == null ? "Former staff member" : author.getFullName(),
                author != null && author.getId().equals(viewer.userId()),
                note.getCreatedAt());
    }

    private static boolean matchesSearch(User patient, String query) {
        return patient.getFirstName().toLowerCase(Locale.ROOT).contains(query)
                || patient.getLastName().toLowerCase(Locale.ROOT).contains(query)
                || patient.getFullName().toLowerCase(Locale.ROOT).contains(query)
                || patient.getEmail().toLowerCase(Locale.ROOT).contains(query)
                || String.valueOf(patient.getId()).equals(query.replaceFirst("^#", ""));
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private static String blankToNull(String value) {
        return isBlank(value) ? null : value.trim();
    }
}
