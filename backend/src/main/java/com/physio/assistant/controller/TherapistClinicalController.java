package com.physio.assistant.controller;

import com.physio.assistant.dto.ClinicalDtos.*;
import com.physio.assistant.dto.ExerciseDtos.*;
import com.physio.assistant.dto.VideoDtos.*;
import com.physio.assistant.security.CurrentUser;
import com.physio.assistant.service.*;
import jakarta.validation.Valid;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.List;

/**
 * Therapist side of the clinical workflow: exercise library management, assessment review,
 * performance, progress comparison and video review. /api/therapist/** requires THERAPIST or
 * ADMIN; patient access and treating-therapist checks happen in the services.
 */
@RestController
@RequestMapping("/api/therapist")
public class TherapistClinicalController {

    private final ExerciseService exerciseService;
    private final AssessmentService assessmentService;
    private final PerformanceService performanceService;
    private final RehabProgressService progressService;
    private final VideoService videoService;

    public TherapistClinicalController(ExerciseService exerciseService, AssessmentService assessmentService,
                                       PerformanceService performanceService, RehabProgressService progressService,
                                       VideoService videoService) {
        this.exerciseService = exerciseService;
        this.assessmentService = assessmentService;
        this.performanceService = performanceService;
        this.progressService = progressService;
        this.videoService = videoService;
    }

    // ---------------------------------------------------------------- exercise library

    @GetMapping("/library/exercises")
    public List<ExerciseResponse> library(@RequestParam(defaultValue = "false") boolean includeArchived) {
        return exerciseService.listLibrary(includeArchived);
    }

    @PostMapping("/library/exercises")
    @ResponseStatus(HttpStatus.CREATED)
    public ExerciseResponse createExercise(Authentication auth, @Valid @RequestBody LibraryExerciseRequest body) {
        return exerciseService.createLibraryExercise(CurrentUser.of(auth), body);
    }

    @PutMapping("/library/exercises/{id}")
    public ExerciseResponse updateExercise(Authentication auth, @PathVariable Long id, @Valid @RequestBody LibraryExerciseRequest body) {
        return exerciseService.updateLibraryExercise(CurrentUser.of(auth), id, body);
    }

    @PutMapping("/library/exercises/{id}/archive")
    public ExerciseResponse archiveExercise(Authentication auth, @PathVariable Long id) {
        return exerciseService.setArchived(CurrentUser.of(auth), id, true);
    }

    @PutMapping("/library/exercises/{id}/restore")
    public ExerciseResponse restoreExercise(Authentication auth, @PathVariable Long id) {
        return exerciseService.setArchived(CurrentUser.of(auth), id, false);
    }

    // ---------------------------------------------------------------- assessments

    @GetMapping("/assessments/pending")
    public List<AssessmentSummary> pendingAssessments(Authentication auth) {
        return assessmentService.pendingReviews(CurrentUser.of(auth));
    }

    @GetMapping("/patients/{patientId}/assessments")
    public List<AssessmentSummary> patientAssessments(Authentication auth, @PathVariable Long patientId) {
        return assessmentService.listForStaff(CurrentUser.of(auth), patientId);
    }

    @PostMapping("/patients/{patientId}/assessments")
    @ResponseStatus(HttpStatus.CREATED)
    public AssessmentResponse recordAssessment(Authentication auth, @PathVariable Long patientId,
                                               @Valid @RequestBody TherapistAssessmentRequest body) {
        return assessmentService.createByTherapist(CurrentUser.of(auth), patientId, body);
    }

    @GetMapping("/assessments/{id}")
    public AssessmentResponse assessment(Authentication auth, @PathVariable Long id) {
        return assessmentService.getForStaff(CurrentUser.of(auth), id);
    }

    @GetMapping("/assessments/{id}/history")
    public List<HistoryEntry> assessmentHistory(Authentication auth, @PathVariable Long id) {
        return assessmentService.history(CurrentUser.of(auth), id);
    }

    @PostMapping("/assessments/{id}/corrections")
    public AssessmentResponse correctAssessment(Authentication auth, @PathVariable Long id, @Valid @RequestBody CorrectionRequest body) {
        return assessmentService.correct(CurrentUser.of(auth), id, body);
    }

    @PostMapping("/assessments/{id}/approve")
    public AssessmentResponse approveAssessment(Authentication auth, @PathVariable Long id,
                                                @Valid @RequestBody(required = false) ReviewCommentRequest body) {
        return assessmentService.approve(CurrentUser.of(auth), id, body);
    }

    @PostMapping("/assessments/{id}/request-revision")
    public AssessmentResponse requestAssessmentRevision(Authentication auth, @PathVariable Long id,
                                                        @Valid @RequestBody RequiredCommentRequest body) {
        return assessmentService.requestRevision(CurrentUser.of(auth), id, body);
    }

    // ---------------------------------------------------------------- performance & progress

    @GetMapping("/patients/{patientId}/performances")
    public List<PerformanceResponse> patientPerformances(Authentication auth, @PathVariable Long patientId) {
        return performanceService.forPatientAsStaff(CurrentUser.of(auth), patientId);
    }

    @PostMapping("/patients/{patientId}/performances")
    @ResponseStatus(HttpStatus.CREATED)
    public PerformanceResponse recordPerformance(Authentication auth, @PathVariable Long patientId,
                                                 @Valid @RequestBody PerformanceRequest body) {
        return performanceService.recordByTherapist(CurrentUser.of(auth), patientId, body);
    }

    @PutMapping("/performances/{id}/feedback")
    public PerformanceResponse feedback(Authentication auth, @PathVariable Long id, @Valid @RequestBody FeedbackRequest body) {
        return performanceService.addFeedback(CurrentUser.of(auth), id, body);
    }

    @GetMapping("/patients/{patientId}/rehab-progress")
    public RehabProgressResponse rehabProgress(Authentication auth, @PathVariable Long patientId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        LocalDate end = to != null ? to : LocalDate.now();
        return progressService.forStaff(CurrentUser.of(auth), patientId, from != null ? from : end.minusDays(89), end);
    }

    // ---------------------------------------------------------------- videos

    @GetMapping("/videos/submissions")
    public List<SubmissionResponse> videoSubmissions(Authentication auth, @RequestParam(required = false) String status) {
        return videoService.submissionsForStaff(CurrentUser.of(auth), status);
    }

    @GetMapping("/videos/submissions/{id}")
    public SubmissionResponse videoSubmission(Authentication auth, @PathVariable Long id) {
        return videoService.submissionForStaff(CurrentUser.of(auth), id);
    }

    @PostMapping("/videos/submissions/{id}/approve")
    public SubmissionResponse approveVideo(Authentication auth, @PathVariable Long id,
                                           @Valid @RequestBody(required = false) ApproveVideoRequest body) {
        return videoService.approve(CurrentUser.of(auth), id, body);
    }

    @PostMapping("/videos/submissions/{id}/reject")
    public SubmissionResponse rejectVideo(Authentication auth, @PathVariable Long id, @Valid @RequestBody ReasonRequest body) {
        return videoService.reject(CurrentUser.of(auth), id, body);
    }

    @PostMapping("/videos/submissions/{id}/request-revision")
    public SubmissionResponse requestVideoRevision(Authentication auth, @PathVariable Long id, @Valid @RequestBody ReasonRequest body) {
        return videoService.requestRevision(CurrentUser.of(auth), id, body);
    }

    @GetMapping("/videos/history")
    public List<HistoryItem> videoReviewHistory(Authentication auth) {
        return videoService.reviewHistory(CurrentUser.of(auth));
    }

    @GetMapping("/videos/library")
    public List<VideoResponse> videoLibrary(@RequestParam(required = false) Long exerciseId) {
        return videoService.library(exerciseId);
    }

    @PostMapping("/videos/library")
    @ResponseStatus(HttpStatus.CREATED)
    public VideoResponse addLibraryVideo(Authentication auth, @Valid @RequestBody LibraryVideoRequest body) {
        return videoService.addToLibrary(CurrentUser.of(auth), body);
    }

    @PutMapping("/videos/library/{id}")
    public VideoResponse linkLibraryVideo(Authentication auth, @PathVariable Long id, @RequestBody LinkVideoRequest body) {
        return videoService.linkToExercise(CurrentUser.of(auth), id, body);
    }

    @DeleteMapping("/videos/library/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void removeLibraryVideo(Authentication auth, @PathVariable Long id) {
        videoService.removeFromLibrary(CurrentUser.of(auth), id);
    }

    @GetMapping("/patients/{patientId}/video-resources")
    public List<ResourceResponse> patientVideoResources(Authentication auth, @PathVariable Long patientId) {
        return videoService.patientResources(CurrentUser.of(auth), patientId);
    }

    @PostMapping("/patients/{patientId}/video-resources")
    @ResponseStatus(HttpStatus.CREATED)
    public ResourceResponse assignVideoResource(Authentication auth, @PathVariable Long patientId,
                                                @Valid @RequestBody AssignVideoRequest body) {
        return videoService.assignResource(CurrentUser.of(auth), patientId, body);
    }

    @DeleteMapping("/video-resources/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void removeVideoResource(Authentication auth, @PathVariable Long id) {
        videoService.removeResource(CurrentUser.of(auth), id);
    }
}
