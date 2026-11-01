package com.physio.assistant.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * What the patient actually did for one prescription on one occasion. Entries come from the
 * patient, the therapist or a computer vision session ({@link #source}); computer vision
 * entries keep the model details in {@link #cvDetails} and link to the session.
 */
@Entity
@Table(name = "exercise_performances")
@Getter
@Setter
public class ExercisePerformance {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "assignment_id")
    private ExerciseAssignment assignment;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "patient_id")
    private User patient;

    @OneToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "session_id")
    private Session session;

    @Column(name = "performed_at", nullable = false)
    private LocalDateTime performedAt;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private MeasurementSource source;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "recorded_by_id")
    private User recordedBy;

    @Column(name = "sets_completed")
    private Integer setsCompleted;

    @Column(name = "reps_completed")
    private Integer repsCompleted;

    @Column(name = "duration_seconds")
    private Integer durationSeconds;

    @Column(name = "pain_level")
    private Integer painLevel;

    @Column(name = "difficulty_rating")
    private Integer difficultyRating;

    @Column(name = "patient_notes", length = 1000)
    private String patientNotes;

    @Column(nullable = false)
    private boolean flagged;

    @Column(name = "flag_reason", length = 500)
    private String flagReason;

    /** JSON: model name/version, pipeline stages, raw metrics (computer vision entries only). */
    @Column(name = "cv_details", columnDefinition = "TEXT")
    private String cvDetails;

    @Column(name = "therapist_feedback", length = 2000)
    private String therapistFeedback;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "feedback_by_id")
    private User feedbackBy;

    @Column(name = "feedback_at")
    private LocalDateTime feedbackAt;

    @OneToMany(mappedBy = "performance", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("id ASC")
    private List<Measurement> measurements = new ArrayList<>();

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
    }
}
