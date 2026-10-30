package com.physio.assistant.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * A physiotherapist's exercise prescription for one patient.
 *
 * Prescriptions are never edited in place once created: changing the dose creates a new
 * prescription linked through {@code previousAssignment} and marks the old one REPLACED, so
 * sessions keep pointing at the prescription that was actually in force and the full
 * prescription history is preserved.
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

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private Status status = Status.ACTIVE;

    // Mirrors status == ACTIVE. Kept for the queries and clients that predate `status`.
    @Column(nullable = false)
    private boolean active = true;

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

    public enum Status { ACTIVE, PAUSED, DISCONTINUED, COMPLETED, REPLACED }

    public enum Difficulty { EASY, MODERATE, HARD }
}
