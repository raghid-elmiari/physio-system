package com.physio.assistant.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.time.LocalDateTime;

/** A YouTube video a patient suggests; reviewed by their assigned physiotherapist. */
@Entity
@Table(name = "patient_video_submissions")
@Getter
@Setter
public class PatientVideoSubmission {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "patient_id")
    private User patient;

    /** The therapist responsible for the review (the patient's therapist when submitted). */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "therapist_id")
    private User therapist;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "exercise_id")
    private Exercise exercise;

    @Column(name = "youtube_video_id", nullable = false, length = 11)
    private String youtubeVideoId;

    @Column(name = "original_url", nullable = false, length = 500)
    private String originalUrl;

    /** From YouTube's oEmbed metadata, never from the patient. */
    @Column(length = 300)
    private String title;

    @Column(name = "thumbnail_url", length = 300)
    private String thumbnailUrl;

    @Column(name = "channel_name", length = 200)
    private String channelName;

    @Column(length = 1000)
    private String description;

    @Column(length = 1000)
    private String reason;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private Status status = Status.PENDING;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "reviewed_by_id")
    private User reviewedBy;

    @Column(name = "reviewed_at")
    private LocalDateTime reviewedAt;

    @Column(length = 1000)
    private String feedback;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "approved_video_id")
    private ExerciseVideo approvedVideo;

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

    public enum Status { PENDING, APPROVED, REJECTED, REVISION_REQUESTED }
}
