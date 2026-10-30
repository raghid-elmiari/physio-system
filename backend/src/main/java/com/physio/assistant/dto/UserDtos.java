package com.physio.assistant.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Past;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.time.LocalDateTime;

public class UserDtos {

    public record ProfileResponse(
            Long id, String firstName, String lastName, String email, String role,
            TherapistSummary therapist, LocalDateTime createdAt
    ) {}

    public record TherapistSummary(Long id, String firstName, String lastName, String email) {}

    public record UpdateProfileRequest(
            @NotBlank(message = "First name is required") @Size(max = 100) String firstName,
            @NotBlank(message = "Last name is required") @Size(max = 100) String lastName
    ) {}

    public record ChangePasswordRequest(
            @NotBlank(message = "Current password is required") String currentPassword,
            @NotBlank(message = "New password is required")
            @Size(min = 8, max = 72, message = "Password must be 8-72 characters")
            @Pattern(regexp = PASSWORD_RULE, message = "Password must contain at least one letter and one number")
            String newPassword
    ) {}

    /** A patient as listed and viewed by their physiotherapist. */
    public record PatientSummary(
            Long id, String firstName, String lastName, String email,
            int activeAssignments, LocalDateTime lastSessionAt,
            String accountStatus, String rehabStatus,
            String phone, LocalDate dateOfBirth, String primaryCondition,
            LocalDateTime registeredAt
    ) {}

    public record LinkPatientRequest(@NotBlank(message = "Patient email is required") String email) {}

    private static final String PASSWORD_RULE = "^(?=.*[A-Za-z])(?=.*\\d).+$";
    private static final String REHAB_STATUS_RULE = "ASSESSMENT|IN_TREATMENT|ON_HOLD|DISCHARGED";
    private static final String PHONE_RULE = "^[+0-9 ()\\-]{0,30}$";

    /** A physiotherapist creates an account for a new patient, linked to themselves. */
    public record CreatePatientRequest(
            @NotBlank(message = "First name is required") @Size(max = 100) String firstName,
            @NotBlank(message = "Last name is required") @Size(max = 100) String lastName,
            @Email(message = "Enter a valid email address") @NotBlank(message = "Email is required") @Size(max = 255) String email,
            @NotBlank(message = "A temporary password is required")
            @Size(min = 8, max = 72, message = "Password must be 8-72 characters")
            @Pattern(regexp = PASSWORD_RULE, message = "Password must contain at least one letter and one number")
            String temporaryPassword,
            @Pattern(regexp = PHONE_RULE, message = "Enter a valid phone number") String phone,
            @Past(message = "Date of birth must be in the past") LocalDate dateOfBirth,
            @Size(max = 255) String primaryCondition,
            @Pattern(regexp = REHAB_STATUS_RULE, message = "Unknown rehabilitation status") String rehabStatus
    ) {}

    public record UpdatePatientRequest(
            @NotBlank(message = "First name is required") @Size(max = 100) String firstName,
            @NotBlank(message = "Last name is required") @Size(max = 100) String lastName,
            @Pattern(regexp = PHONE_RULE, message = "Enter a valid phone number") String phone,
            @Past(message = "Date of birth must be in the past") LocalDate dateOfBirth,
            @Size(max = 255) String primaryCondition,
            @NotBlank(message = "Rehabilitation status is required")
            @Pattern(regexp = REHAB_STATUS_RULE, message = "Unknown rehabilitation status") String rehabStatus
    ) {}

    public record AccountStatusRequest(
            @NotBlank(message = "status is required")
            @Pattern(regexp = "ACTIVE|DISABLED", message = "status must be ACTIVE or DISABLED") String status
    ) {}

    public record NoteRequest(
            @NotBlank(message = "The note cannot be empty") @Size(max = 4000, message = "Notes are limited to 4000 characters")
            String text
    ) {}

    public record NoteResponse(Long id, String text, String authorName, boolean writtenByMe, LocalDateTime createdAt) {}
}
