package com.physio.assistant.dto;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.constraints.*;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

public class AdminDtos {

    public record AdminUserResponse(
            Long id, String firstName, String lastName, String email, String role, String status,
            Long therapistId, String therapistName, Long patientCount, String rehabStatus,
            LocalDateTime createdAt, LocalDateTime updatedAt
    ) {}

    public record CreateUserRequest(
            @NotBlank(message = "First name is required") @Size(max = 100) String firstName,
            @NotBlank(message = "Last name is required") @Size(max = 100) String lastName,
            @Email(message = "Enter a valid email address") @NotBlank(message = "Email is required") @Size(max = 255) String email,
            @NotBlank(message = "A temporary password is required")
            @Size(min = 8, max = 72, message = "Password must be 8-72 characters")
            @Pattern(regexp = "^(?=.*[A-Za-z])(?=.*\\d).+$", message = "Password must contain at least one letter and one number")
            String temporaryPassword,
            @NotBlank @Pattern(regexp = "PATIENT|THERAPIST|ADMIN", message = "role must be PATIENT, THERAPIST or ADMIN") String role,
            /** Optional: assign a new patient to this therapist straight away. */
            Long therapistId
    ) {}

    public record ChangeRoleRequest(
            @NotBlank @Pattern(regexp = "PATIENT|THERAPIST|ADMIN", message = "role must be PATIENT, THERAPIST or ADMIN") String role,
            @Size(max = 500) String reason
    ) {}

    public record ChangeStatusRequest(
            @NotBlank @Pattern(regexp = "ACTIVE|DISABLED", message = "status must be ACTIVE or DISABLED") String status,
            @Size(max = 500) String reason
    ) {}

    /** therapistId null removes the assignment. */
    public record AssignTherapistRequest(Long therapistId, @Size(max = 500) String reason) {}

    public record TherapistWorkload(
            Long id, String name, String email, String status, long patients, long activePatients,
            long pendingAssessments, long pendingVideoReviews, long prescriptionsAwaitingApproval, long activePrescriptions
    ) {}

    public record AdminStats(
            Map<String, Long> usersByRole, long activeUsers, long disabledUsers, long unassignedPatients,
            long assessmentsAwaitingReview, long prescriptionsAwaitingApproval, long activePrescriptions,
            long videoSuggestionsPending, long sessionsLast30Days, long performanceEntriesLast30Days
    ) {}

    public record AuditEntry(
            Long id, String action, String entityType, Long entityId, Long patientId, String patientName,
            String actorName, String actorRole, String summary, JsonNode details, LocalDateTime createdAt
    ) {}

    public record AuditPage(List<AuditEntry> entries, int page, int size, long total) {}

    /** The fixed role model, for display. Permissions are enforced in code (SecurityConfig + services). */
    public record RolePermissions(String role, String description, List<String> allowed, List<String> denied) {}
}
