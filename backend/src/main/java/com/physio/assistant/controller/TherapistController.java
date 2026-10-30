package com.physio.assistant.controller;

import com.physio.assistant.dto.DashboardDtos.DashboardOverview;
import com.physio.assistant.dto.ExerciseDtos.*;
import com.physio.assistant.dto.ProgressDtos.ProgressResponse;
import com.physio.assistant.dto.ReportDtos.*;
import com.physio.assistant.dto.SessionDtos.SessionResponse;
import com.physio.assistant.dto.UserDtos.*;
import com.physio.assistant.security.CurrentUser;
import com.physio.assistant.service.ExerciseService;
import com.physio.assistant.service.PatientReportService;
import com.physio.assistant.service.TherapistDashboardService;
import com.physio.assistant.service.TherapistService;
import jakarta.validation.Valid;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.List;

/**
 * Physiotherapist / admin API. Access to /api/therapist/** requires the THERAPIST or ADMIN
 * role (SecurityConfig); every patient-specific call is additionally checked against the
 * caller's own caseload in the service layer.
 */
@RestController
@RequestMapping("/api/therapist")
public class TherapistController {

    private final TherapistService therapistService;
    private final TherapistDashboardService dashboardService;
    private final PatientReportService reportService;
    private final ExerciseService exerciseService;

    public TherapistController(TherapistService therapistService, TherapistDashboardService dashboardService,
                               PatientReportService reportService, ExerciseService exerciseService) {
        this.therapistService = therapistService;
        this.dashboardService = dashboardService;
        this.reportService = reportService;
        this.exerciseService = exerciseService;
    }

    // ---------------------------------------------------------------- dashboard

    @GetMapping("/dashboard")
    public DashboardOverview dashboard(Authentication auth) {
        return dashboardService.overview(CurrentUser.of(auth));
    }

    // ---------------------------------------------------------------- exercise library

    /** New exercise analysed against the therapist's reference recording (built on the device). */
    @PostMapping("/exercises")
    @ResponseStatus(HttpStatus.CREATED)
    public ExerciseResponse createReferenceExercise(@Valid @RequestBody ReferenceExerciseRequest request) {
        return exerciseService.createReferenceExercise(request);
    }

    @PutMapping("/exercises/{exerciseId}")
    public ExerciseResponse updateReferenceExercise(@PathVariable Long exerciseId,
                                                    @Valid @RequestBody ReferenceExerciseRequest request) {
        return exerciseService.updateReferenceExercise(exerciseId, request);
    }

    // ---------------------------------------------------------------- patients

    @GetMapping("/patients")
    public List<PatientSummary> listPatients(Authentication auth,
                                             @RequestParam(required = false) String search,
                                             @RequestParam(required = false) String rehabStatus,
                                             @RequestParam(required = false) String accountStatus) {
        return therapistService.listPatients(CurrentUser.of(auth), search, rehabStatus, accountStatus);
    }

    /** Links an existing patient account (by email) to the caller. */
    @PostMapping("/patients")
    public PatientSummary linkPatient(Authentication auth, @Valid @RequestBody LinkPatientRequest request) {
        return therapistService.linkPatient(CurrentUser.of(auth), request);
    }

    /** Creates a new patient account linked to the caller. */
    @PostMapping("/patients/new")
    @ResponseStatus(HttpStatus.CREATED)
    public PatientSummary createPatient(Authentication auth, @Valid @RequestBody CreatePatientRequest request) {
        return therapistService.createPatient(CurrentUser.of(auth), request);
    }

    @GetMapping("/patients/{patientId}")
    public PatientSummary getPatient(Authentication auth, @PathVariable Long patientId) {
        return therapistService.getPatient(CurrentUser.of(auth), patientId);
    }

    @PutMapping("/patients/{patientId}")
    public PatientSummary updatePatient(Authentication auth, @PathVariable Long patientId,
                                        @Valid @RequestBody UpdatePatientRequest request) {
        return therapistService.updatePatient(CurrentUser.of(auth), patientId, request);
    }

    @PutMapping("/patients/{patientId}/account-status")
    public PatientSummary changeAccountStatus(Authentication auth, @PathVariable Long patientId,
                                              @Valid @RequestBody AccountStatusRequest request) {
        return therapistService.changeAccountStatus(CurrentUser.of(auth), patientId, request);
    }

    @GetMapping("/patients/{patientId}/sessions")
    public List<SessionResponse> patientSessions(Authentication auth, @PathVariable Long patientId) {
        return therapistService.patientSessions(CurrentUser.of(auth), patientId);
    }

    @GetMapping("/patients/{patientId}/progress")
    public ProgressResponse patientProgress(Authentication auth, @PathVariable Long patientId,
                                            @RequestParam(defaultValue = "90") int days) {
        return therapistService.patientProgress(CurrentUser.of(auth), patientId, days);
    }

    /** Session-by-session performance for a date range (defaults to the last 30 days). */
    @GetMapping("/patients/{patientId}/performance")
    public PatientMeasurements patientPerformance(
            Authentication auth, @PathVariable Long patientId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        LocalDate periodEnd = to != null ? to : LocalDate.now();
        LocalDate periodStart = from != null ? from : periodEnd.minusDays(29);
        return reportService.patientPerformance(CurrentUser.of(auth), patientId, periodStart, periodEnd);
    }

    // ---------------------------------------------------------------- prescriptions

    @GetMapping("/patients/{patientId}/assignments")
    public List<AssignmentResponse> patientPrescriptions(Authentication auth, @PathVariable Long patientId,
                                                         @RequestParam(defaultValue = "false") boolean includeHistory) {
        return therapistService.patientAssignments(CurrentUser.of(auth), patientId, includeHistory);
    }

    @PostMapping("/patients/{patientId}/assignments")
    @ResponseStatus(HttpStatus.CREATED)
    public AssignmentResponse prescribeExercise(Authentication auth, @PathVariable Long patientId,
                                                @Valid @RequestBody CreateAssignmentRequest request) {
        return therapistService.assign(CurrentUser.of(auth), patientId, request);
    }

    /** Edits a prescription by creating a new version; the old one is kept as REPLACED. */
    @PutMapping("/assignments/{assignmentId}")
    public AssignmentResponse revisePrescription(Authentication auth, @PathVariable Long assignmentId,
                                                 @Valid @RequestBody CreateAssignmentRequest request) {
        return therapistService.revisePrescription(CurrentUser.of(auth), assignmentId, request);
    }

    /** Pause, resume, complete or discontinue a prescription. */
    @PutMapping("/assignments/{assignmentId}/status")
    public AssignmentResponse changePrescriptionStatus(Authentication auth, @PathVariable Long assignmentId,
                                                       @Valid @RequestBody AssignmentStatusRequest request) {
        return therapistService.changePrescriptionStatus(CurrentUser.of(auth), assignmentId, request);
    }

    @DeleteMapping("/assignments/{assignmentId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void discontinuePrescription(Authentication auth, @PathVariable Long assignmentId) {
        therapistService.deactivateAssignment(CurrentUser.of(auth), assignmentId);
    }

    // ---------------------------------------------------------------- clinical notes

    @GetMapping("/patients/{patientId}/notes")
    public List<NoteResponse> patientNotes(Authentication auth, @PathVariable Long patientId) {
        return therapistService.patientNotes(CurrentUser.of(auth), patientId);
    }

    @PostMapping("/patients/{patientId}/notes")
    @ResponseStatus(HttpStatus.CREATED)
    public NoteResponse addNote(Authentication auth, @PathVariable Long patientId, @Valid @RequestBody NoteRequest request) {
        return therapistService.addNote(CurrentUser.of(auth), patientId, request);
    }

    @DeleteMapping("/notes/{noteId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteNote(Authentication auth, @PathVariable Long noteId) {
        therapistService.deleteNote(CurrentUser.of(auth), noteId);
    }

    // ---------------------------------------------------------------- reports

    @GetMapping("/patients/{patientId}/reports")
    public List<ReportSummary> patientReports(Authentication auth, @PathVariable Long patientId) {
        return reportService.reportsForPatient(CurrentUser.of(auth), patientId);
    }

    @PostMapping("/patients/{patientId}/reports")
    @ResponseStatus(HttpStatus.CREATED)
    public ReportResponse generateReport(Authentication auth, @PathVariable Long patientId,
                                         @Valid @RequestBody CreateReportRequest request) {
        return reportService.generateReport(CurrentUser.of(auth), patientId, request);
    }

    @GetMapping("/reports/{reportId}")
    public ReportResponse getReport(Authentication auth, @PathVariable Long reportId) {
        return reportService.getReportForTherapist(CurrentUser.of(auth), reportId);
    }

    @PutMapping("/reports/{reportId}")
    public ReportResponse updateReport(Authentication auth, @PathVariable Long reportId,
                                       @Valid @RequestBody UpdateReportRequest request) {
        return reportService.updateReport(CurrentUser.of(auth), reportId, request);
    }

    @DeleteMapping("/reports/{reportId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteReport(Authentication auth, @PathVariable Long reportId) {
        reportService.deleteReport(CurrentUser.of(auth), reportId);
    }
}
