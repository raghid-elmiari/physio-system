package com.physio.assistant.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

/** A therapist-defined, patient-specific target for one parameter of a prescription. */
@Entity
@Table(name = "prescription_targets")
@Getter
@Setter
public class PrescriptionTarget {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "assignment_id")
    private ExerciseAssignment assignment;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "parameter_id")
    private ExerciseParameter parameter;

    @Column(name = "target_value")
    private Double targetValue;

    @Column(name = "target_min")
    private Double targetMin;

    @Column(name = "target_max")
    private Double targetMax;

    @Column(nullable = false, length = 20)
    private String unit;

    @Column(nullable = false, length = 100)
    private String label;

    @Column(length = 300)
    private String note;

    /** Same convention as {@link Measurement#comparableValue()}. */
    public Double comparableValue() {
        if (targetValue != null) return targetValue;
        if (targetMin != null && targetMax != null) return targetMax - targetMin;
        return targetMax;
    }
}
