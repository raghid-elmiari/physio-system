package com.physio.assistant.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * A physiotherapist's exercise prescription for one patient.
 *
 * Prescriptions are never edited in place once created: changing the dose creates a new
 * prescription linked through {@code previousAssignment} and marks the old one REPLACED, so
 * sessions keep pointing at the prescription that was actually in force and the full
 * prescription history is preserved.
 *
 * A new prescription is PENDING_APPROVAL: being prescribed is not clinical clearance. The
 * patient's assigned physiotherapist approves it (APPROVED, or ACTIVE once its start date is
 * reached); only an ACTIVE prescription can be started by the patient.
 */
@Entity
@Table(name = "exercise_assignments")
@Getter
@Setter
public class ExerciseAssignment {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "patient_id")
    private User patient;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "exercise_id")
    private Exercise exercise;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "assigned_by_id")
    private User assignedBy;

    @Column(name = "target_reps", nullable = false)
    private Integer targetReps;

    @Column(name = "sets_per_session", nullable = false)
    private Integer setsPerSession = 1;

    /** Prescribed frequency. */
    @Column(name = "sessions_per_week")
    private Integer sessionsPerWeek;

    /** Hold / work time per set, when the exercise is time-based. */
    @Column(name = "duration_seconds")
    private Integer durationSeconds;

    @Column(name = "rest_seconds")
    private Integer restSeconds;

    @Column(name = "start_date")
    private LocalDate startDate;

    @Column(name = "end_date")
    private LocalDate endDate;

    @Enumerated(EnumType.STRING)
    @Column(length = 20)
    private Difficulty difficulty;

    /** Specific instructions for the patient (shown on their dashboard). */
    @Column(length = 500)
    private String notes;

    /** Patient-specific exercise instructions (defaults to the library instructions when prescribed). */
    @Column(length = 4000)
    private String instructions;

    @Column(name = "safety_instructions", length = 1000)
    private String safetyInstructions;

    @Column(name = "expected_progression", length = 1000)
    private String expectedProgression;

    /** Why this version was created (revisions only). */
    @Column(name = "change_reason", length = 500)
    private String changeReason;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "approved_by_id")
    private User approvedBy;

    @Column(name = "approved_at")
    private LocalDateTime approvedAt;

    @Column(name = "approval_note", length = 500)
    private String approvalNote;

    @OneToMany(mappedBy = "assignment", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("id ASC")
    private List<PrescriptionTarget> targets = new ArrayList<>();

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private Status status = Status.PENDING_APPROVAL;

    // Mirrors status == ACTIVE. Kept for the queries and clients that predate `status`.
    @Column(nullable = false)
    private boolean active = false;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "previous_assignment_id")
    private ExerciseAssignment previousAssignment;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at")
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

    public void changeStatus(Status newStatus) {
        this.status = newStatus;
        this.active = newStatus == Status.ACTIVE;
    }

    /** True while the patient should be doing this exercise on the given day. */
    public boolean isInForceOn(LocalDate day) {
        return status == Status.ACTIVE
                && (startDate == null || !day.isBefore(startDate))
                && (endDate == null || !day.isAfter(endDate));
    }

    /** True once a physiotherapist has approved this prescription (or the version it replaced was approved). */
    public boolean isApproved() {
        return approvedAt != null;
    }

    /** Shown in the patient's program (including ones not yet startable, with their status). */
    public boolean isVisibleToPatient() {
        return status == Status.PENDING_APPROVAL || status == Status.APPROVED
                || status == Status.ACTIVE || status == Status.PAUSED;
    }

    public enum Status { PENDING_APPROVAL, APPROVED, ACTIVE, PAUSED, DISCONTINUED, COMPLETED, REPLACED }

    public enum Difficulty { EASY, MODERATE, HARD }
}
