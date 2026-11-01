package com.physio.assistant.controller;

import com.physio.assistant.dto.ClinicalDtos.*;
import com.physio.assistant.dto.ExerciseDtos.ExerciseResponse;
import com.physio.assistant.dto.VideoDtos.*;
import com.physio.assistant.security.CurrentUser;
import com.physio.assistant.service.*;
import com.physio.assistant.entity.User;
import com.physio.assistant.repository.UserRepository;
import com.physio.assistant.exception.ApiException;
import jakarta.validation.Valid;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.List;

/**
 * Patient self-service: physical assessments, performance logging, progress, video suggestions.
 * /api/patient/** requires the PATIENT role; every call is scoped to the signed-in patient, and
 * no patient or therapist ID is ever taken from the request.
 */
@RestController
@RequestMapping("/api/patient")
public class PatientClinicalController {

    private final AssessmentService assessmentService;
    private final PerformanceService performanceService;
    private final RehabProgressService progressService;
    private final VideoService videoService;
    private final ExerciseService exerciseService;
    private final UserRepository userRepository;

    public PatientClinicalController(AssessmentService assessmentService, PerformanceService performanceService,
                                     RehabProgressService progressService, VideoService videoService,
                                     ExerciseService exerciseService, UserRepository userRepository) {
        this.assessmentService = assessmentService;
        this.performanceService = performanceService;
        this.progressService = progressService;
        this.videoService = videoService;
        this.exerciseService = exerciseService;
        this.userRepository = userRepository;
    }

    // ---------------------------------------------------------------- assessments

    @GetMapping("/assessment-status")
    public AssessmentStatusResponse assessmentStatus(Authentication auth) {
        return assessmentService.statusFor(CurrentUser.of(auth).userId());
    }

    /** Library exercises with assessment parameters the patient can measure. */
    @GetMapping("/assessment-exercises")
    public List<ExerciseResponse> assessableExercises() {
        return exerciseService.assessableExercises();
    }

    @GetMapping("/assessments")
    public List<AssessmentSummary> assessments(Authentication auth) {
        return assessmentService.listForPatient(CurrentUser.of(auth).userId());
    }

    @PostMapping("/assessments")
    @ResponseStatus(HttpStatus.CREATED)
    public AssessmentResponse startAssessment(Authentication auth, @Valid @RequestBody(required = false) CreateAssessmentRequest body) {
        return assessmentService.create(CurrentUser.of(auth).userId(), body);
    }

    @GetMapping("/assessments/{id}")
    public AssessmentResponse assessment(Authentication auth, @PathVariable Long id) {
        return assessmentService.getOwn(CurrentUser.of(auth).userId(), id);
    }

    @PutMapping("/assessments/{id}")
    public AssessmentResponse saveAssessment(Authentication auth, @PathVariable Long id, @Valid @RequestBody SaveAssessmentRequest body) {
        return assessmentService.save(CurrentUser.of(auth), id, body);
    }

    @PostMapping("/assessments/{id}/submit")
    public AssessmentResponse submitAssessment(Authentication auth, @PathVariable Long id) {
        return assessmentService.submit(CurrentUser.of(auth), id);
    }

    @GetMapping("/assessments/{id}/history")
    public List<HistoryEntry> assessmentHistory(Authentication auth, @PathVariable Long id) {
        return assessmentService.history(CurrentUser.of(auth), id);
    }

    // ---------------------------------------------------------------- performance

    @GetMapping("/performances")
    public List<PerformanceResponse> performances(Authentication auth) {
        return performanceService.forPatient(CurrentUser.of(auth).userId());
    }

    @PostMapping("/performances")
    @ResponseStatus(HttpStatus.CREATED)
    public PerformanceResponse logPerformance(Authentication auth, @Valid @RequestBody PerformanceRequest body) {
        return performanceService.recordByPatient(CurrentUser.of(auth).userId(), body);
    }

    /** Baseline vs target vs latest for the signed-in patient (defaults to the last 90 days). */
    @GetMapping("/rehab-progress")
    public RehabProgressResponse rehabProgress(Authentication auth,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        User me = userRepository.findById(CurrentUser.of(auth).userId()).orElseThrow(() -> ApiException.unauthorized("Unknown user"));
        LocalDate end = to != null ? to : LocalDate.now();
        return progressService.compute(me, from != null ? from : end.minusDays(89), end);
    }

    // ---------------------------------------------------------------- videos

    @GetMapping("/videos")
    public PatientVideoLibrary myVideos(Authentication auth) {
        return videoService.myVideos(CurrentUser.of(auth).userId());
    }

    @GetMapping("/video-submissions")
    public List<SubmissionResponse> mySubmissions(Authentication auth) {
        return videoService.mySubmissions(CurrentUser.of(auth).userId());
    }

    @PostMapping("/video-submissions")
    @ResponseStatus(HttpStatus.CREATED)
    public SubmissionResponse suggestVideo(Authentication auth, @Valid @RequestBody VideoSubmissionRequest body) {
        return videoService.submit(CurrentUser.of(auth), body);
    }

    @PutMapping("/video-submissions/{id}")
    public SubmissionResponse resubmitVideo(Authentication auth, @PathVariable Long id, @Valid @RequestBody VideoSubmissionRequest body) {
        return videoService.resubmit(CurrentUser.of(auth), id, body);
    }
}
