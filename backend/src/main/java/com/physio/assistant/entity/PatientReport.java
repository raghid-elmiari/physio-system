package com.physio.assistant.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * A rehabilitation report for one patient over a date range.
 *
 * The system-generated part (session counts, repetitions, accuracy, detected movement
 * errors, adherence) is computed once and frozen in {@code measurementsJson}, so a report
 * reads the same later even if data changes. The physiotherapist's professional assessment
 * lives in the separate text fields and is always labelled as such.
 */
@Entity
@Table(name = "patient_reports")
@Getter
@Setter
public class PatientReport {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "patient_id")
    private User patient;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "author_id")
    private User author;

    @Column(length = 200)
    private String title;

    @Column(name = "period_start", nullable = false)
    private LocalDate periodStart;

    @Column(name = "period_end", nullable = false)
    private LocalDate periodEnd;

    @Column(name = "measurements_json", nullable = false, columnDefinition = "JSON")
    private String measurementsJson;

    @Column(length = 4000)
    private String observations;

    @Column(length = 4000)
    private String recommendations;

    @Column(name = "exercise_modifications", length = 4000)
    private String exerciseModifications;

    @Column(name = "follow_up_instructions", length = 4000)
    private String followUpInstructions;

    @Column(name = "shared_with_patient", nullable = false)
    private boolean sharedWithPatient;

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
}
