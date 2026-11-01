package com.physio.assistant.service;

import com.physio.assistant.entity.User;
import com.physio.assistant.exception.ApiException;
import com.physio.assistant.repository.UserRepository;
import com.physio.assistant.security.AuthPrincipal;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * Single place that decides which patients a staff member may see.
 *
 * A physiotherapist (THERAPIST) may only access patients linked to them; an ADMIN may access
 * every patient. Anything else is reported as "not found" so the existence of other
 * patients is never revealed.
 */
@Component
public class PatientAccessPolicy {

    private final UserRepository userRepository;

    public PatientAccessPolicy(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    public User requireAccessiblePatient(AuthPrincipal staffMember, Long patientId) {
        User patient = userRepository.findById(patientId)
                .filter(User::isPatient)
                .orElseThrow(() -> patientNotFound(patientId));
        if (!canAccess(staffMember, patient)) throw patientNotFound(patientId);
        return patient;
    }

    public boolean canAccess(AuthPrincipal staffMember, User patient) {
        if (!patient.isPatient()) return false;
        if (isAdmin(staffMember)) return true;
        return "THERAPIST".equals(staffMember.role())
                && patient.getTherapist() != null
                && patient.getTherapist().getId().equals(staffMember.userId());
    }

    /**
     * Clinical decisions (approving assessments, prescriptions and videos) belong to the
     * patient's assigned physiotherapist only. Others who may see the patient (another
     * therapist cannot; an admin can) get 404 or 403 respectively.
     */
    public User requireTreatingTherapist(AuthPrincipal staffMember, Long patientId) {
        User patient = requireAccessiblePatient(staffMember, patientId);
        if (!isTreatingTherapist(staffMember, patient)) {
            throw ApiException.forbidden("Only the patient's assigned physiotherapist can make this decision");
        }
        return patient;
    }

    public boolean isTreatingTherapist(AuthPrincipal staffMember, User patient) {
        return "THERAPIST".equals(staffMember.role())
                && patient.getTherapist() != null
                && patient.getTherapist().getId().equals(staffMember.userId());
    }

    /** IDs of the patients in this staff member's caseload. */
    public List<Long> caseloadIds(AuthPrincipal staffMember) {
        return caseload(staffMember).stream().map(User::getId).toList();
    }

    /** The patients this staff member is responsible for, sorted by name. */
    public List<User> caseload(AuthPrincipal staffMember) {
        return isAdmin(staffMember)
                ? userRepository.findByRoleOrderByLastNameAscFirstNameAsc(User.Role.PATIENT)
                : userRepository.findByTherapistIdOrderByLastNameAscFirstNameAsc(staffMember.userId());
    }

    private static boolean isAdmin(AuthPrincipal principal) {
        return "ADMIN".equals(principal.role());
    }

    private static ApiException patientNotFound(Long patientId) {
        return ApiException.notFound("Patient not found: " + patientId);
    }
}
