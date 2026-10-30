package com.physio.assistant.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.math.BigDecimal;
import java.time.LocalDateTime;

@Entity
@Table(name = "exercises")
@Getter
@Setter
public class Exercise {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 150)
    private String name;

    @Column(columnDefinition = "TEXT")
    private String description;

    @Column(name = "reference_video_path", length = 500)
    private String referenceVideoPath;

    @Column(name = "reference_keypoints_path", length = 500)
    private String referenceKeypointsPath;

    @Column(name = "match_stability_seconds", nullable = false, precision = 4, scale = 2)
    private BigDecimal matchStabilitySeconds = new BigDecimal("1.50");

    // Selects the on-device rule-based analyzer (frontend src/core/exercises/registry.js).
    // Null means the exercise has no camera analysis yet.
    @Column(name = "analyzer_key", length = 64)
    private String analyzerKey;

    @Column(columnDefinition = "TEXT")
    private String instructions;

    @Column(name = "camera_setup", length = 500)
    private String cameraSetup;

    @Column(name = "body_region", length = 50)
    private String bodyRegion;

    @Column(name = "default_reps", nullable = false)
    private Integer defaultReps = 10;

    // Per-exercise thresholds consumed by the analyzer; merged over the analyzer defaults.
    @Column(name = "analysis_config_json", columnDefinition = "JSON")
    private String analysisConfigJson;

    @Column(nullable = false)
    private boolean active = true;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
    }
}
