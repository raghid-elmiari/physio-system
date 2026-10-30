package com.physio.assistant.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.math.BigDecimal;
import java.time.LocalDateTime;

@Entity
@Table(name = "session_reports")
@Getter
@Setter
public class SessionReport {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @OneToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "session_id", unique = true)
    private Session session;

    @Column(name = "accuracy_pct", nullable = false, precision = 5, scale = 2)
    private BigDecimal accuracyPct;

    @Column(name = "total_reps", nullable = false)
    private Integer totalReps;

    @Column(name = "correct_reps")
    private Integer correctReps;

    @Column(name = "duration_seconds")
    private Integer durationSeconds;

    @Column(name = "common_mistakes_json", columnDefinition = "JSON")
    private String commonMistakesJson;

    @Column(name = "metrics_json", columnDefinition = "JSON")
    private String metricsJson;

    @Column(name = "generated_at", nullable = false)
    private LocalDateTime generatedAt;

    @PrePersist
    protected void onCreate() {
        generatedAt = LocalDateTime.now();
    }
}
