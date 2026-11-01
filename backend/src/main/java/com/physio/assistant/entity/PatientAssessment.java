package com.physio.assistant.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * A physical assessment of one patient: per exercise, the measured capabilities.
 *
 * The first APPROVED assessment of type INITIAL is the patient's baseline. Once approved an
 * assessment is immutable; later measurements are stored as separate FOLLOW_UP assessments,
 * and a corrected baseline is a new INITIAL assessment that {@code supersedes} the old one.
 */
@Entity
@Table(name = "patient_assessments")
@Getter
@Setter
public class PatientAssessment {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "patient_id")
    private User patient;

    @Enumerated(EnumType.STRING)
    @Column(name = "assessment_type", nullable = false, length = 20)
    private Type assessmentType = Type.INITIAL;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private Status status = Status.IN_PROGRESS;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "created_by_id")
    private User createdBy;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "supersedes_id")
    private PatientAssessment supersedes;

    @Column(name = "patient_notes", length = 2000)
    private String patientNotes;

    @Column(name = "submitted_at")
    private LocalDateTime submittedAt;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "reviewed_by_id")
    private User reviewedBy;

    @Column(name = "reviewed_at")
    private LocalDateTime reviewedAt;

    @Column(name = "review_comment", length = 2000)
    private String reviewComment;

    @Column(name = "approved_at")
    private LocalDateTime approvedAt;

    @OneToMany(mappedBy = "assessment", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("id ASC")
    private List<AssessmentItem> items = new ArrayList<>();

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

    /** The patient may change measurements only while drafting or after a revision request. */
    public boolean isEditableByPatient() {
        return status == Status.IN_PROGRESS || status == Status.REVISION_REQUESTED;
    }

    public boolean isAwaitingReview() {
        return status == Status.SUBMITTED || status == Status.PENDING_REVIEW;
    }

    public enum Type { INITIAL, FOLLOW_UP }

    /** NOT_STARTED is never stored: it is reported when a patient has no assessment at all. */
    public enum Status { NOT_STARTED, IN_PROGRESS, SUBMITTED, PENDING_REVIEW, APPROVED, REVISION_REQUESTED }
}
