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

    public TherapistService(UserRepository userRepository, ExerciseAssignmentRepository assignmentRepository,
                            SessionRepository sessionRepository, TherapistNoteRepository noteRepository,
                            ExerciseService exerciseService, SessionService sessionService,
                            ProgressService progressService, AuthService authService,
                            PatientAccessPolicy accessPolicy, PasswordEncoder passwordEncoder) {
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
        return toSummary(userRepository.save(patient));
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
        patient.setStatus(newStatus);
        if (newStatus == User.Status.DISABLED) authService.revokeAllSessions(patient.getId());
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

    @Transactional
    public AssignmentResponse assign(AuthPrincipal therapist, Long patientId, CreateAssignmentRequest request) {
        User patient = accessPolicy.requireAccessiblePatient(therapist, patientId);
        return exerciseService.createAssignment(patient, userRepository.getReferenceById(therapist.userId()), request);
    }

    @Transactional
    public AssignmentResponse revisePrescription(AuthPrincipal therapist, Long assignmentId, CreateAssignmentRequest request) {
        ExerciseAssignment current = requireAccessiblePrescription(therapist, assignmentId);
        return exerciseService.revisePrescription(current, userRepository.getReferenceById(therapist.userId()), request);
    }

    @Transactional
    public AssignmentResponse changePrescriptionStatus(AuthPrincipal therapist, Long assignmentId, AssignmentStatusRequest request) {
        ExerciseAssignment prescription = requireAccessiblePrescription(therapist, assignmentId);
        if (prescription.getStatus() == ExerciseAssignment.Status.REPLACED) {
            throw ApiException.conflict("This prescription was replaced by a newer version; change that one instead");
        }
        prescription.changeStatus(ExerciseAssignment.Status.valueOf(request.status()));
        return exerciseService.toResponse(prescription);
    }

    /** Kept for existing clients: DELETE discontinues the prescription (history is never deleted). */
    @Transactional
    public void deactivateAssignment(AuthPrincipal therapist, Long assignmentId) {
        ExerciseAssignment prescription = requireAccessiblePrescription(therapist, assignmentId);
        if (prescription.getStatus() != ExerciseAssignment.Status.REPLACED) {
            prescription.changeStatus(ExerciseAssignment.Status.DISCONTINUED);
        }
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
