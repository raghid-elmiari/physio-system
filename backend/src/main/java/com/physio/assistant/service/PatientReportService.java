package com.physio.assistant.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.physio.assistant.dto.ReportDtos.*;
import com.physio.assistant.entity.PatientReport;
import com.physio.assistant.entity.User;
import com.physio.assistant.exception.ApiException;
import com.physio.assistant.repository.PatientReportRepository;
import com.physio.assistant.repository.UserRepository;
import com.physio.assistant.security.AuthPrincipal;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.List;

/**
 * Individual patient reports. A physiotherapist generates a report for one of their
 * patients and date range; the measurements are frozen at that moment, and the
 * physiotherapist adds their professional assessment. A patient can read a report only
 * after it has been explicitly shared with them.
 */
@Service
public class PatientReportService {

    private static final DateTimeFormatter TITLE_DATE = DateTimeFormatter.ofPattern("d MMM yyyy");

    private final PatientReportRepository reportRepository;
    private final UserRepository userRepository;
    private final PatientMeasurementService measurementService;
    private final PatientAccessPolicy accessPolicy;
    private final ObjectMapper objectMapper;
    private final RehabProgressService rehabProgressService;
    private final AuditService auditService;

    public PatientReportService(PatientReportRepository reportRepository, UserRepository userRepository,
                                PatientMeasurementService measurementService, PatientAccessPolicy accessPolicy,
                                ObjectMapper objectMapper, RehabProgressService rehabProgressService, AuditService auditService) {
        this.reportRepository = reportRepository;
        this.userRepository = userRepository;
        this.measurementService = measurementService;
        this.accessPolicy = accessPolicy;
        this.objectMapper = objectMapper;
        this.rehabProgressService = rehabProgressService;
        this.auditService = auditService;
    }

    // ---------------------------------------------------------------- physiotherapist

    /** Live performance figures for any date range, without storing a report. */
    @Transactional(readOnly = true)
    public PatientMeasurements patientPerformance(AuthPrincipal therapist, Long patientId, LocalDate from, LocalDate to) {
        User patient = accessPolicy.requireAccessiblePatient(therapist, patientId);
        return measurementService.measure(patient, from, to);
    }

    @Transactional
    public ReportResponse generateReport(AuthPrincipal therapist, Long patientId, CreateReportRequest request) {
        User patient = accessPolicy.requireAccessiblePatient(therapist, patientId);
        if (request.to().isAfter(LocalDate.now())) {
            throw ApiException.badRequest("A report cannot end in the future");
        }
        PatientMeasurements measurements = measurementService.measure(patient, request.from(), request.to())
                .withRehabProgress(rehabProgressService.compute(patient, request.from(), request.to()));

        PatientReport report = new PatientReport();
        report.setPatient(patient);
        report.setAuthor(userRepository.getReferenceById(therapist.userId()));
        report.setTitle(request.title() == null || request.title().isBlank()
                ? defaultTitle(request.from(), request.to()) : request.title().trim());
        report.setPeriodStart(request.from());
        report.setPeriodEnd(request.to());
        report.setMeasurementsJson(toJson(measurements));
        report = reportRepository.save(report);
        auditService.record(therapist, "REPORT_GENERATED", "REPORT", report.getId(), patient,
                "Generated report \"" + report.getTitle() + "\"", null);
        return toResponse(report);
    }

    @Transactional(readOnly = true)
    public List<ReportSummary> reportsForPatient(AuthPrincipal therapist, Long patientId) {
        accessPolicy.requireAccessiblePatient(therapist, patientId);
        return reportRepository.findByPatientIdOrderByCreatedAtDesc(patientId).stream().map(this::toSummary).toList();
    }

    @Transactional(readOnly = true)
    public ReportResponse getReportForTherapist(AuthPrincipal therapist, Long reportId) {
        return toResponse(requireAccessibleReport(therapist, reportId));
    }

    /** Saves the professional assessment and the sharing flag. Measurements are never edited. */
    @Transactional
    public ReportResponse updateReport(AuthPrincipal therapist, Long reportId, UpdateReportRequest request) {
        PatientReport report = requireAccessibleReport(therapist, reportId);
        if (request.title() != null && !request.title().isBlank()) report.setTitle(request.title().trim());
        report.setObservations(trimToNull(request.observations()));
        report.setRecommendations(trimToNull(request.recommendations()));
        report.setExerciseModifications(trimToNull(request.exerciseModifications()));
        report.setFollowUpInstructions(trimToNull(request.followUpInstructions()));
        boolean wasShared = report.isSharedWithPatient();
        if (request.sharedWithPatient() != null) report.setSharedWithPatient(request.sharedWithPatient());
        auditService.record(therapist, "REPORT_UPDATED", "REPORT", report.getId(), report.getPatient(),
                "Updated report \"" + report.getTitle() + "\"" + (wasShared != report.isSharedWithPatient()
                        ? (report.isSharedWithPatient() ? " and shared it with the patient" : " and stopped sharing it") : ""), null);
        return toResponse(report);
    }

    @Transactional
    public void deleteReport(AuthPrincipal therapist, Long reportId) {
        PatientReport report = requireAccessibleReport(therapist, reportId);
        auditService.record(therapist, "REPORT_DELETED", "REPORT", report.getId(), report.getPatient(),
                "Deleted report \"" + report.getTitle() + "\"", null);
        reportRepository.delete(report);
    }

    private PatientReport requireAccessibleReport(AuthPrincipal therapist, Long reportId) {
        return reportRepository.findById(reportId)
                .filter(report -> accessPolicy.canAccess(therapist, report.getPatient()))
                .orElseThrow(() -> ApiException.notFound("Report not found: " + reportId));
    }

    // ---------------------------------------------------------------- patient

    @Transactional(readOnly = true)
    public List<ReportSummary> sharedReportsForPatient(Long patientId) {
        return reportRepository.findByPatientIdAndSharedWithPatientTrueOrderByCreatedAtDesc(patientId).stream()
                .map(this::toSummary).toList();
    }

    /** A patient may open only their own reports, and only once shared. */
    @Transactional(readOnly = true)
    public ReportResponse getSharedReportForPatient(Long patientId, Long reportId) {
        return reportRepository.findById(reportId)
                .filter(report -> report.getPatient().getId().equals(patientId) && report.isSharedWithPatient())
                .map(this::toResponse)
                .orElseThrow(() -> ApiException.notFound("Report not found: " + reportId));
    }

    // ---------------------------------------------------------------- mapping

    private ReportSummary toSummary(PatientReport report) {
        return new ReportSummary(report.getId(), report.getPatient().getId(), report.getTitle(),
                report.getPeriodStart(), report.getPeriodEnd(), authorName(report.getAuthor()),
                report.isSharedWithPatient(), report.getCreatedAt(), report.getUpdatedAt());
    }

    private ReportResponse toResponse(PatientReport report) {
        return new ReportResponse(report.getId(), report.getPatient().getId(), report.getTitle(),
                report.getPeriodStart(), report.getPeriodEnd(), authorName(report.getAuthor()),
                report.isSharedWithPatient(), report.getCreatedAt(), report.getUpdatedAt(),
                fromJson(report.getMeasurementsJson()),
                new ProfessionalAssessment(report.getObservations(), report.getRecommendations(),
                        report.getExerciseModifications(), report.getFollowUpInstructions()));
    }

    private String toJson(PatientMeasurements measurements) {
        try {
            return objectMapper.writeValueAsString(measurements);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Could not serialise report measurements", e);
        }
    }

    private PatientMeasurements fromJson(String json) {
        try {
            return objectMapper.readValue(json, PatientMeasurements.class);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Stored report measurements are unreadable", e);
        }
    }

    private static String defaultTitle(LocalDate from, LocalDate to) {
        return "Rehabilitation report " + TITLE_DATE.format(from) + " – " + TITLE_DATE.format(to);
    }

    private static String authorName(User author) {
        return author == null ? null : author.getFullName();
    }

    private static String trimToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
