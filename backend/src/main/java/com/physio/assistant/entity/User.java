package com.physio.assistant.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.time.LocalDate;
import java.time.LocalDateTime;

@Entity
@Table(name = "users")
@Getter
@Setter
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "first_name", nullable = false, length = 100)
    private String firstName;

    @Column(name = "last_name", nullable = false, length = 100)
    private String lastName;

    @Column(nullable = false, unique = true, length = 255)
    private String email;

    @Column(name = "password_hash", nullable = false, length = 255)
    private String passwordHash;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private Role role = Role.PATIENT;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private Status status = Status.ACTIVE;

    // Set for PATIENT users who are linked to a therapist; null otherwise.
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "therapist_id")
    private User therapist;

    // Patient profile details, maintained by the physiotherapist. Null for staff accounts.
    @Column(length = 30)
    private String phone;

    @Column(name = "date_of_birth")
    private LocalDate dateOfBirth;

    @Column(name = "primary_condition", length = 255)
    private String primaryCondition;

    @Enumerated(EnumType.STRING)
    @Column(name = "rehab_status", length = 20)
    private RehabStatus rehabStatus;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
        updatedAt = createdAt;
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = LocalDateTime.now();
    }

    public enum Role { PATIENT, THERAPIST, ADMIN }
    public enum Status { ACTIVE, DISABLED }

    /** Where the patient is in their rehabilitation pathway (set by the physiotherapist). */
    public enum RehabStatus { ASSESSMENT, IN_TREATMENT, ON_HOLD, DISCHARGED }

    public String getFullName() {
        return firstName + " " + lastName;
    }

    public boolean isPatient() {
        return role == Role.PATIENT;
    }
}
