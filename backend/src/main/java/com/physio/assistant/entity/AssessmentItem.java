package com.physio.assistant.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.util.ArrayList;
import java.util.List;

/** One exercise/movement inside an assessment, with its subjective ratings and measured values. */
@Entity
@Table(name = "assessment_items")
@Getter
@Setter
public class AssessmentItem {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "assessment_id")
    private PatientAssessment assessment;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "exercise_id")
    private Exercise exercise;

    /** 0 (none) to 10 (worst imaginable). */
    @Column(name = "pain_level")
    private Integer painLevel;

    /** 1 (very easy) to 5 (could not do it). */
    @Column(name = "difficulty_rating")
    private Integer difficultyRating;

    /** Whether the patient can perform the movement without help. */
    private Boolean independent;

    @Column(name = "limitation_notes", length = 1000)
    private String limitationNotes;

    @OneToMany(mappedBy = "assessmentItem", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("id ASC")
    private List<Measurement> measurements = new ArrayList<>();
}
