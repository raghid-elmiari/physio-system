package com.physio.assistant.controller;

import com.physio.assistant.dto.ReportDtos.ReportResponse;
import com.physio.assistant.dto.ReportDtos.ReportSummary;
import com.physio.assistant.security.CurrentUser;
import com.physio.assistant.service.PatientReportService;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/** Reports a physiotherapist has shared with the signed-in patient. Patients never see unshared reports. */
@RestController
@RequestMapping("/api/reports")
public class PatientReportController {

    private final PatientReportService reportService;

    public PatientReportController(PatientReportService reportService) {
        this.reportService = reportService;
    }

    @GetMapping
    public List<ReportSummary> mySharedReports(Authentication auth) {
        return reportService.sharedReportsForPatient(CurrentUser.of(auth).userId());
    }

    @GetMapping("/{reportId}")
    public ReportResponse mySharedReport(Authentication auth, @PathVariable Long reportId) {
        return reportService.getSharedReportForPatient(CurrentUser.of(auth).userId(), reportId);
    }
}
