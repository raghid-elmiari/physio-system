package com.physio.assistant.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.physio.assistant.dto.AdminDtos.*;
import com.physio.assistant.entity.*;
import com.physio.assistant.exception.ApiException;
import com.physio.assistant.repository.*;
import com.physio.assistant.security.AuthPrincipal;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.*;

/**
 * Administrator controls: accounts, roles, activation, therapist–patient assignment,
 * workloads, statistics and the audit trail.
 *
 * Records are never deleted. Changes that would orphan clinical records are refused (a
 * therapist with patients cannot lose the role; a patient with clinical history cannot become
 * staff); deactivation is the way to remove access.
 */
@Service
public class AdminService {

    private final UserRepository userRepository;
    private final PatientAssessmentRepository assessmentRepository;
    private final ExerciseAssignmentRepository assignmentRepository;
    private final PatientVideoSubmissionRepository submissionRepository;
    private final SessionRepository sessionRepository;
    private final ExercisePerformanceRepository performanceRepository;
    private final AuditLogRepository auditLogRepository;
    private final AuthService authService;
    private final AuditService auditService;
    private final NotificationService notificationService;
    private final AssessmentService assessmentService;
    private final VideoService videoService;
    private final PasswordEncoder passwordEncoder;
    private final ObjectMapper objectMapper;

    public AdminService(UserRepository userRepository, PatientAssessmentRepository assessmentRepository,
                        ExerciseAssignmentRepository assignmentRepository, PatientVideoSubmissionRepository submissionRepository,
                        SessionRepository sessionRepository, ExercisePerformanceRepository performanceRepository,
                        AuditLogRepository auditLogRepository, AuthService authService, AuditService auditService,
                        NotificationService notificationService, AssessmentService assessmentService, VideoService videoService,
                        PasswordEncoder passwordEncoder, ObjectMapper objectMapper) {
        this.userRepository = userRepository;
        this.assessmentRepository = assessmentRepository;
        this.assignmentRepository = assignmentRepository;
        this.submissionRepository = submissionRepository;
        this.sessionRepository = sessionRepository;
        this.performanceRepository = performanceRepository;
        this.auditLogRepository = auditLogRepository;
        this.authService = authService;
        this.auditService = auditService;
        this.notificationService = notificationService;
        this.assessmentService = assessmentService;
        this.videoService = videoService;
        this.passwordEncoder = passwordEncoder;
        this.objectMapper = objectMapper;
    }

    // ---------------------------------------------------------------- users

    @Transactional(readOnly = true)
    public List<AdminUserResponse> listUsers(String role, String status, String search) {
        String q = search == null ? "" : search.trim().toLowerCase(Locale.ROOT);
        return userRepository.findAllByOrderByLastNameAscFirstNameAsc().stream()
                .filter(u -> role == null || role.isBlank() || u.getRole().name().equalsIgnoreCase(role))
                .filter(u -> status == null || status.isBlank() || u.getStatus().name().equalsIgnoreCase(status))
                .filter(u -> q.isEmpty() || u.getFullName().toLowerCase(Locale.ROOT).contains(q)
                        || u.getEmail().contains(q) || String.valueOf(u.getId()).equals(q.replaceFirst("^#", "")))
                .map(this::toResponse).toList();
    }

    @Transactional(readOnly = true)
    public AdminUserResponse getUser(Long id) {
        return toResponse(requireUser(id));
    }

    @Transactional
    public AdminUserResponse createUser(AuthPrincipal admin, CreateUserRequest req) {
        String email = AuthService.normalizeEmail(req.email());
        if (userRepository.existsByEmailIgnoreCase(email)) throw ApiException.conflict("An account with this email already exists");
        User user = new User();
        user.setFirstName(req.firstName().trim());
        user.setLastName(req.lastName().trim());
        user.setEmail(email);
        user.setPasswordHash(passwordEncoder.encode(req.temporaryPassword()));
        user.setRole(User.Role.valueOf(req.role()));
        if (user.isPatient()) {
            user.setRehabStatus(User.RehabStatus.ASSESSMENT);
            if (req.therapistId() != null) user.setTherapist(requireActiveTherapist(req.therapistId()));
        } else if (req.therapistId() != null) {
            throw ApiException.badRequest("Only patients can be assigned to a therapist");
        }
        user = userRepository.save(user);
        auditService.record(admin, "USER_CREATED", "USER", user.getId(), user.isPatient() ? user : null,
                "Created " + user.getRole() + " account " + user.getFullName() + " <" + email + ">", null);
        if (user.getTherapist() != null) {
            notificationService.notify(user.getTherapist(), NotificationService.PATIENT_ASSIGNED,
                    user.getFullName() + " was assigned to you", null, "/patients/" + user.getId(), "USER", user.getId());
        }
        return toResponse(user);
    }

    @Transactional
    public AdminUserResponse changeRole(AuthPrincipal admin, Long userId, ChangeRoleRequest req) {
        User user = requireUser(userId);
        User.Role to = User.Role.valueOf(req.role());
        User.Role from = user.getRole();
        if (from == to) return toResponse(user);
        if (user.getId().equals(admin.userId())) throw ApiException.conflict("You cannot change your own role");
        if (from == User.Role.ADMIN && userRepository.countByRoleAndStatus(User.Role.ADMIN, User.Status.ACTIVE) <= 1
                && user.getStatus() == User.Status.ACTIVE) {
            throw ApiException.conflict("At least one active administrator must remain");
        }
        if (from == User.Role.THERAPIST && userRepository.countByTherapistId(user.getId()) > 0) {
            throw ApiException.conflict("Reassign this therapist's patients before changing their role");
        }
        if (from == User.Role.PATIENT && hasClinicalHistory(user)) {
            throw ApiException.conflict("This patient has clinical records. Deactivate the account and create a separate staff account instead.");
        }
        user.setRole(to);
        if (from == User.Role.PATIENT) {
            user.setTherapist(null);
            user.setRehabStatus(null);
        }
        if (to == User.Role.PATIENT && user.getRehabStatus() == null) user.setRehabStatus(User.RehabStatus.ASSESSMENT);
        // Tokens carry no role (it is read from the database per request), but sign the user out
        // so every device reloads with the new permissions.
        authService.revokeAllSessions(user.getId());
        auditService.record(admin, "ROLE_CHANGED", "USER", user.getId(), null,
                user.getFullName() + ": " + from + " → " + to, details("from", from.name(), "to", to.name(), "reason", req.reason()));
        return toResponse(user);
    }

    @Transactional
    public AdminUserResponse changeStatus(AuthPrincipal admin, Long userId, ChangeStatusRequest req) {
        User user = requireUser(userId);
        User.Status to = User.Status.valueOf(req.status());
        User.Status from = user.getStatus();
        if (from == to) return toResponse(user);
        if (user.getId().equals(admin.userId())) throw ApiException.conflict("You cannot deactivate your own account");
        if (to == User.Status.DISABLED && user.getRole() == User.Role.ADMIN
                && userRepository.countByRoleAndStatus(User.Role.ADMIN, User.Status.ACTIVE) <= 1) {
            throw ApiException.conflict("At least one active administrator must remain");
        }
        user.setStatus(to);
        if (to == User.Status.DISABLED) authService.revokeAllSessions(user.getId());
        auditService.record(admin, to == User.Status.DISABLED ? "ACCOUNT_DEACTIVATED" : "ACCOUNT_ACTIVATED", "USER", user.getId(),
                user.isPatient() ? user : null, user.getFullName() + ": " + from + " → " + to,
                details("from", from.name(), "to", to.name(), "reason", req.reason()));
        return toResponse(user);
    }

    /** Assigns, reassigns or unassigns a patient's physiotherapist. Pending reviews follow the patient. */
    @Transactional
    public AdminUserResponse assignTherapist(AuthPrincipal admin, Long patientId, AssignTherapistRequest req) {
        User patient = requireUser(patientId);
        if (!patient.isPatient()) throw ApiException.badRequest("Only patients can be assigned to a therapist");
        User previous = patient.getTherapist();
        User next = req.therapistId() == null ? null : requireActiveTherapist(req.therapistId());
        if (Objects.equals(previous == null ? null : previous.getId(), next == null ? null : next.getId())) return toResponse(patient);
        patient.setTherapist(next);
        assessmentService.routeWaitingSubmissions(patient);
        videoService.routePendingSubmissions(patient);
        auditService.record(admin, previous == null ? "THERAPIST_ASSIGNED" : next == null ? "THERAPIST_UNASSIGNED" : "THERAPIST_REASSIGNED",
                "USER", patient.getId(), patient,
                patient.getFullName() + ": " + (previous == null ? "unassigned" : previous.getFullName()) + " → "
                        + (next == null ? "unassigned" : next.getFullName()),
                details("fromTherapistId", previous == null ? null : String.valueOf(previous.getId()),
                        "toTherapistId", next == null ? null : String.valueOf(next.getId()), "reason", req.reason()));
        if (next != null) {
            notificationService.notify(next, NotificationService.PATIENT_ASSIGNED, patient.getFullName() + " was assigned to you",
                    req.reason(), "/patients/" + patient.getId(), "USER", patient.getId());
            notificationService.notify(patient, NotificationService.THERAPIST_ASSIGNED,
                    next.getFullName() + " is now your physiotherapist", null, "/profile", "USER", next.getId());
        }
        return toResponse(patient);
    }

    // ---------------------------------------------------------------- overview

    @Transactional(readOnly = true)
    public List<TherapistWorkload> therapistWorkloads() {
        return userRepository.findByRoleOrderByLastNameAscFirstNameAsc(User.Role.THERAPIST).stream().map(t -> {
            List<User> patients = userRepository.findByTherapistIdOrderByLastNameAscFirstNameAsc(t.getId());
            List<Long> ids = patients.stream().map(User::getId).toList();
            long active = patients.stream().filter(p -> p.getStatus() == User.Status.ACTIVE).count();
            long pendingAssessments = ids.isEmpty() ? 0 : assessmentRepository.countByPatientIdInAndStatusIn(ids, AssessmentService.AWAITING_REVIEW);
            long pendingVideos = ids.isEmpty() ? 0 : submissionRepository.countByPatientIdInAndStatus(ids, PatientVideoSubmission.Status.PENDING);
            long awaitingApproval = ids.isEmpty() ? 0 : assignmentRepository.findByPatientIdInAndStatus(ids, ExerciseAssignment.Status.PENDING_APPROVAL).size();
            long activeRx = ids.isEmpty() ? 0 : assignmentRepository.findByPatientIdInAndStatus(ids, ExerciseAssignment.Status.ACTIVE).size();
            return new TherapistWorkload(t.getId(), t.getFullName(), t.getEmail(), t.getStatus().name(), patients.size(), active,
                    pendingAssessments, pendingVideos, awaitingApproval, activeRx);
        }).toList();
    }

    @Transactional(readOnly = true)
    public AdminStats stats() {
        List<User> users = userRepository.findAll();
        Map<String, Long> byRole = new LinkedHashMap<>();
        for (User.Role r : User.Role.values()) byRole.put(r.name(), users.stream().filter(u -> u.getRole() == r).count());
        List<Long> patientIds = users.stream().filter(User::isPatient).map(User::getId).toList();
        LocalDateTime since = LocalDateTime.now().minusDays(30);
        return new AdminStats(byRole,
                users.stream().filter(u -> u.getStatus() == User.Status.ACTIVE).count(),
                users.stream().filter(u -> u.getStatus() == User.Status.DISABLED).count(),
                users.stream().filter(u -> u.isPatient() && u.getTherapist() == null).count(),
                patientIds.isEmpty() ? 0 : assessmentRepository.countByPatientIdInAndStatusIn(patientIds, AssessmentService.AWAITING_REVIEW),
                patientIds.isEmpty() ? 0 : assignmentRepository.findByPatientIdInAndStatus(patientIds, ExerciseAssignment.Status.PENDING_APPROVAL).size(),
                patientIds.isEmpty() ? 0 : assignmentRepository.findByPatientIdInAndStatus(patientIds, ExerciseAssignment.Status.ACTIVE).size(),
                patientIds.isEmpty() ? 0 : submissionRepository.countByPatientIdInAndStatus(patientIds, PatientVideoSubmission.Status.PENDING),
                sessionRepository.findAll().stream().filter(s -> s.getStartedAt().isAfter(since)).count(),
                performanceRepository.findAll().stream().filter(p -> p.getPerformedAt().isAfter(since)).count());
    }

    @Transactional(readOnly = true)
    public AuditPage auditLog(String entityType, Long actorId, int page, int size) {
        int pageSize = Math.max(1, Math.min(size, 100));
        Page<AuditLog> result = auditLogRepository.search(blankToNull(entityType), actorId, PageRequest.of(Math.max(0, page), pageSize));
        return new AuditPage(result.getContent().stream().map(this::toEntry).toList(), result.getNumber(), pageSize, result.getTotalElements());
    }

    /** The fixed role model. */
    public List<RolePermissions> permissions() {
        return List.of(
                new RolePermissions("ADMIN", "Manages accounts, roles and therapist assignments",
                        List.of("Create user accounts", "Change roles", "Activate / deactivate accounts", "Assign and reassign patients",
                                "View therapist workloads", "View all patients' records", "View the audit log", "Manage system configuration"),
                        List.of("Approve assessments, prescriptions or videos (clinical decisions belong to the assigned therapist)")),
                new RolePermissions("THERAPIST", "Treats the patients assigned to them",
                        List.of("See assigned patients only", "Review, correct and approve assessments", "Create, edit and archive library exercises",
                                "Prescribe exercises and set personal targets", "Approve, pause, resume or discontinue prescriptions",
                                "Record measurements and give feedback", "Review patient video suggestions", "Generate and share reports"),
                        List.of("Access other therapists' patients", "Change roles or assignments")),
                new RolePermissions("PATIENT", "Follows their own rehabilitation program",
                        List.of("Complete and revise their own assessments", "View their approved program and videos",
                                "Submit performance measurements", "View their own progress and shared reports",
                                "Suggest YouTube videos", "Receive notifications"),
                        List.of("Change their role", "See other patients' data", "Modify targets", "Approve their own assessments or videos",
                                "Add exercises to the library", "Assign exercises to themselves", "Start unapproved exercises")));
    }

    // ---------------------------------------------------------------- helpers

    private boolean hasClinicalHistory(User patient) {
        return !assessmentRepository.findByPatientIdOrderByCreatedAtDesc(patient.getId()).isEmpty()
                || !assignmentRepository.findByPatientIdOrderByCreatedAtDesc(patient.getId()).isEmpty()
                || sessionRepository.findFirstByUserIdOrderByStartedAtDesc(patient.getId()).isPresent();
    }

    private User requireUser(Long id) {
        return userRepository.findById(id).orElseThrow(() -> ApiException.notFound("User not found: " + id));
    }

    private User requireActiveTherapist(Long id) {
        User t = requireUser(id);
        if (t.getRole() != User.Role.THERAPIST) throw ApiException.badRequest("User " + id + " is not a therapist");
        if (t.getStatus() != User.Status.ACTIVE) throw ApiException.conflict("This therapist's account is deactivated");
        return t;
    }

    private AdminUserResponse toResponse(User u) {
        Long patients = u.getRole() == User.Role.THERAPIST ? userRepository.countByTherapistId(u.getId()) : null;
        return new AdminUserResponse(u.getId(), u.getFirstName(), u.getLastName(), u.getEmail(), u.getRole().name(), u.getStatus().name(),
                u.getTherapist() == null ? null : u.getTherapist().getId(),
                u.getTherapist() == null ? null : u.getTherapist().getFullName(),
                patients, u.getRehabStatus() == null ? null : u.getRehabStatus().name(), u.getCreatedAt(), u.getUpdatedAt());
    }

    private AuditEntry toEntry(AuditLog a) {
        com.fasterxml.jackson.databind.JsonNode details = null;
        if (a.getDetails() != null) {
            try {
                details = objectMapper.readTree(a.getDetails());
            } catch (Exception ignored) {
                // details stay null
            }
        }
        return new AuditEntry(a.getId(), a.getAction(), a.getEntityType(), a.getEntityId(),
                a.getPatient() == null ? null : a.getPatient().getId(), a.getPatient() == null ? null : a.getPatient().getFullName(),
                a.getActor() == null ? "System" : a.getActor().getFullName(), a.getActorRole(), a.getSummary(), details, a.getCreatedAt());
    }

    private static Map<String, String> details(String... kv) {
        Map<String, String> m = new LinkedHashMap<>();
        for (int i = 0; i + 1 < kv.length; i += 2) if (kv[i + 1] != null) m.put(kv[i], kv[i + 1]);
        return m;
    }

    private static String blankToNull(String v) {
        return v == null || v.isBlank() ? null : v.trim();
    }
}
