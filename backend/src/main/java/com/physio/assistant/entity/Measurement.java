package com.physio.assistant.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.time.LocalDateTime;

/**
 * One measured value of an exercise parameter, owned by either an assessment item or a
 * performance entry. Label and unit are copied from the parameter when recorded.
 *
 * A therapist correction never overwrites the value: it is a new THERAPIST_MEASURED row that
 * points to the corrected one ({@code corrects}), and the corrected row is marked superseded.
 */
@Entity
@Table(name = "measurements")
@Getter
@Setter
public class Measurement {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "assessment_item_id")
    private AssessmentItem assessmentItem;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "performance_id")
    private ExercisePerformance performance;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "parameter_id")
    private ExerciseParameter parameter;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private MeasurementSource source;

    /** Single-value measurements. */
    @Column(name = "measured_value")
    private Double value;

    /** Range measurements (e.g. 0°–65°). */
    @Column(name = "measured_min")
    private Double valueMin;

    @Column(name = "measured_max")
    private Double valueMax;

    @Column(nullable = false, length = 20)
    private String unit;

    @Column(nullable = false, length = 100)
    private String label;

    @Column(length = 500)
    private String note;

    /** Outside the expected range or otherwise implausible: a therapist should look at it. */
    @Column(nullable = false)
    private boolean flagged;

    @Column(name = "flag_reason", length = 300)
    private String flagReason;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "recorded_by_id")
    private User recordedBy;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "corrects_id")
    private Measurement corrects;

    @Column(nullable = false)
    private boolean superseded;

    @Column(name = "measured_at", nullable = false)
    private LocalDateTime measuredAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
        if (measuredAt == null) measuredAt = createdAt;
    }

    /** The single comparable figure: the value, or the span of a range (max − min). */
    public Double comparableValue() {
        if (value != null) return value;
        if (valueMin != null && valueMax != null) return valueMax - valueMin;
        return valueMax;
    }
}
