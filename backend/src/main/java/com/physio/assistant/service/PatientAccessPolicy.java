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
