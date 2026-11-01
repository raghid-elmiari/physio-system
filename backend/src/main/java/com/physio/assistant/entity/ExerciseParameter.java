package com.physio.assistant.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.time.LocalDateTime;

/**
 * A measurable quantity of a library exercise (e.g. "knee flexion range of motion" in degrees).
 *
 * Assessments, prescription targets and performance entries all refer to parameters, and each
 * of them also stores the label and unit that applied at the time, so editing the library never
 * changes the meaning of recorded values. A parameter that is no longer wanted is archived
 * ({@code active = false}), never deleted, because measurements may reference it.
 */
@Entity
@Table(name = "exercise_parameters")
@Getter
@Setter
public class ExerciseParameter {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "exercise_id")
    private Exercise exercise;

    /** Stable machine name, unique per exercise. */
    @Column(nullable = false, length = 50)
    private String code;

    @Column(nullable = false, length = 100)
    private String label;

    @Enumerated(EnumType.STRING)
    @Column(name = "measurement_type", nullable = false, length = 20)
    private MeasurementType measurementType;

    @Column(nullable = false, length = 20)
    private String unit;

    /** True when a measurement is a range (minimum and maximum angle), e.g. 0°–65°. */
    @Column(name = "range_measurement", nullable = false)
    private boolean rangeMeasurement;

    /** Physically possible values; anything outside is rejected. */
    @Column(name = "min_valid")
    private Double minValid;

    @Column(name = "max_valid")
    private Double maxValid;

    /** Expected (normal) range, e.g. 0°–120° for knee flexion. Values outside are flagged for review. */
    @Column(name = "normal_min")
    private Double normalMin;

    @Column(name = "normal_max")
    private Double normalMax;

    @Column(name = "higher_is_better", nullable = false)
    private boolean higherIsBetter = true;

    /** Offered in the patient's physical assessment. */
    @Column(name = "assessment_enabled", nullable = false)
    private boolean assessmentEnabled = true;

    /** Metric key written by the on-device analyzer that maps to this parameter (computer vision). */
    @Column(name = "cv_metric_key", length = 64)
    private String cvMetricKey;

    @Column(name = "sort_order", nullable = false)
    private int sortOrder;

    @Column(nullable = false)
    private boolean active = true;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
    }

    public enum MeasurementType { ANGLE, FLEXIBILITY, REPETITIONS, DURATION, DISTANCE, PAIN, CUSTOM }
}
