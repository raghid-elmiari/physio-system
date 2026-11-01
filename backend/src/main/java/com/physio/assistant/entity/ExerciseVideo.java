package com.physio.assistant.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.time.LocalDateTime;

/**
 * A YouTube video approved as an educational resource. Only the validated 11-character video
 * ID is stored; embeds are always built from it, never from user-supplied HTML.
 */
@Entity
@Table(name = "exercise_videos")
@Getter
@Setter
public class ExerciseVideo {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "exercise_id")
    private Exercise exercise;

    @Column(name = "youtube_video_id", nullable = false, length = 11)
    private String youtubeVideoId;

    @Column(length = 300)
    private String title;

    @Column(name = "thumbnail_url", length = 300)
    private String thumbnailUrl;

    @Column(name = "channel_name", length = 200)
    private String channelName;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    private Origin origin;

    /** Listed in the exercise library (as a demonstration video of its exercise). */
    @Column(name = "in_library", nullable = false)
    private boolean inLibrary;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "added_by_id")
    private User addedBy;

    @Column(nullable = false)
    private boolean active = true;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
    }

    public enum Origin { THERAPIST, PATIENT_SUBMISSION }
}
