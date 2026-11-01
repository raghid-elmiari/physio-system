package com.physio.assistant;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.physio.assistant.entity.User;
import com.physio.assistant.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.time.LocalDate;
import java.util.*;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The clinical workflow end to end, through the real security chain against H2 + Flyway:
 * admin assignment → patient assessment → therapist review → prescription with targets →
 * approval → performance → progress comparison, plus the YouTube suggestion workflow,
 * notifications, the exercise library and role isolation.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles({"h2", "test"})
class ClinicalWorkflowIntegrationTest {

    private static final String PASSWORD = "Secret123";

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired UserRepository userRepository;
    @Autowired PasswordEncoder passwordEncoder;

    private String admin;
    private String therapist;
    private long therapistId;
    private String otherTherapist;
    private long kneeId;
    private long kneeRomParam;
    private long kneeRepsParam;

    @BeforeEach
    void setUp() throws Exception {
        admin = login(createUser("admin", User.Role.ADMIN).getEmail());
        User t = createUser("therapist", User.Role.THERAPIST);
        therapistId = t.getId();
        therapist = login(t.getEmail());
        otherTherapist = login(createUser("other", User.Role.THERAPIST).getEmail());
        JsonNode knee = exerciseNamed(therapist, "Seated Knee Flexion");
        kneeId = knee.get("id").asLong();
        kneeRomParam = paramId(knee, "knee_flexion_rom");
        kneeRepsParam = paramId(knee, "repetitions");
    }

    // ================================================================== admin & RBAC

    @Test
    void adminManagesUsersRolesAndAssignmentsWithAuditTrail() throws Exception {
        JsonNode created = read(call(post("/api/admin/users"), admin, Map.of("firstName", "Nina", "lastName", "New",
                "email", unique("nina"), "temporaryPassword", "Temp1234", "role", "PATIENT")).andExpect(status().isCreated()));
        long patientId = created.get("id").asLong();
        assertThat(created.get("therapistId").isNull()).isTrue();
        String patient = login(created.get("email").asText(), "Temp1234");

        // Only admins reach /api/admin; patients and therapists get 403.
        call(get("/api/admin/users"), patient, null).andExpect(status().isForbidden());
        call(get("/api/admin/users"), therapist, null).andExpect(status().isForbidden());
        call(put("/api/admin/users/" + patientId + "/role"), patient, Map.of("role", "ADMIN")).andExpect(status().isForbidden());

        // Assign to a therapist: they are notified and can now see the patient; the other therapist cannot.
        call(get("/api/therapist/patients/" + patientId), therapist, null).andExpect(status().isNotFound());
        call(put("/api/admin/patients/" + patientId + "/therapist"), admin, Map.of("therapistId", therapistId, "reason", "Knee caseload"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.therapistId").value(therapistId));
        call(get("/api/therapist/patients/" + patientId), therapist, null).andExpect(status().isOk());
        call(get("/api/therapist/patients/" + patientId), otherTherapist, null).andExpect(status().isNotFound());
        assertThat(types(read(call(get("/api/notifications"), therapist, null)))).contains("PATIENT_ASSIGNED");

        // Workload shows the patient.
        JsonNode workload = read(call(get("/api/admin/therapists/workload"), admin, null).andExpect(status().isOk()));
        assertThat(find(workload, "id", therapistId).get("patients").asLong()).isEqualTo(1);

        // A therapist with patients cannot lose the role; an admin cannot change their own role.
        call(put("/api/admin/users/" + therapistId + "/role"), admin, Map.of("role", "PATIENT")).andExpect(status().isConflict());
        long adminId = read(call(get("/api/users/me"), admin, null)).get("id").asLong();
        call(put("/api/admin/users/" + adminId + "/role"), admin, Map.of("role", "THERAPIST")).andExpect(status().isConflict());
        call(put("/api/admin/users/" + adminId + "/status"), admin, Map.of("status", "DISABLED")).andExpect(status().isConflict());

        // Deactivation takes effect at once; reactivation restores access.
        call(put("/api/admin/users/" + patientId + "/status"), admin, Map.of("status", "DISABLED")).andExpect(status().isOk());
        call(get("/api/users/me"), patient, null).andExpect(status().isUnauthorized());
        call(put("/api/admin/users/" + patientId + "/status"), admin, Map.of("status", "ACTIVE")).andExpect(status().isOk());

        // A patient with no clinical history can be promoted; one with history cannot.
        JsonNode promotable = read(call(post("/api/admin/users"), admin, Map.of("firstName", "Sam", "lastName", "Staff",
                "email", unique("sam"), "temporaryPassword", "Temp1234", "role", "PATIENT")));
        call(put("/api/admin/users/" + promotable.get("id").asLong() + "/role"), admin, Map.of("role", "THERAPIST"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.role").value("THERAPIST"));
        String freshPatient = login(created.get("email").asText(), "Temp1234");
        call(post("/api/patient/assessments"), freshPatient, Map.of()).andExpect(status().isCreated());
        call(put("/api/admin/users/" + patientId + "/role"), admin, Map.of("role", "THERAPIST")).andExpect(status().isConflict());

        // Everything above is in the audit trail.
        JsonNode audit = read(call(get("/api/admin/audit-logs?entityType=USER&size=100"), admin, null).andExpect(status().isOk()));
        List<String> actions = new ArrayList<>();
        audit.get("entries").forEach(e -> actions.add(e.get("action").asText()));
        assertThat(actions).contains("USER_CREATED", "THERAPIST_ASSIGNED", "ACCOUNT_DEACTIVATED", "ACCOUNT_ACTIVATED", "ROLE_CHANGED");
        assertThat(read(call(get("/api/admin/permissions"), admin, null))).hasSize(3);
        call(get("/api/admin/stats"), admin, null).andExpect(status().isOk()).andExpect(jsonPath("$.usersByRole.ADMIN").isNumber());
    }

    // ================================================================== assessment → baseline

    @Test
    void assessmentReviewCorrectionApprovalAndImmutableBaseline() throws Exception {
        Patient p = newPatient(true);

        call(get("/api/patient/assessment-status"), p.token, null).andExpect(jsonPath("$.status").value("NOT_STARTED"));
        JsonNode assessable = read(call(get("/api/patient/assessment-exercises"), p.token, null));
        assertThat(find(assessable, "id", kneeId)).isNotNull();

        long id = read(call(post("/api/patient/assessments"), p.token, Map.of()).andExpect(status().isCreated())
                .andExpect(jsonPath("$.type").value("INITIAL")).andExpect(jsonPath("$.status").value("IN_PROGRESS"))).get("id").asLong();
        call(post("/api/patient/assessments"), p.token, Map.of()).andExpect(status().isConflict()); // one open at a time

        // Physically impossible values are rejected; range needs min ≤ max.
        call(put("/api/patient/assessments/" + id), p.token, assessmentBody(0, 400)).andExpect(status().isBadRequest());
        call(put("/api/patient/assessments/" + id), p.token, assessmentBody(70, 20)).andExpect(status().isBadRequest());
        // Submitting with nothing measured is refused.
        call(post("/api/patient/assessments/" + id + "/submit"), p.token, null).andExpect(status().isBadRequest());

        JsonNode saved = read(call(put("/api/patient/assessments/" + id), p.token, assessmentBody(0, 65)).andExpect(status().isOk()));
        JsonNode rom = measurement(saved, kneeRomParam);
        assertThat(rom.get("source").asText()).isEqualTo("PATIENT_REPORTED");
        assertThat(rom.get("differenceFromExpected").asDouble()).isEqualTo(55.0); // expected 0–120 vs achieved 0–65

        call(post("/api/patient/assessments/" + id + "/submit"), p.token, null)
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("PENDING_REVIEW"));
        assertThat(types(read(call(get("/api/notifications"), therapist, null)))).contains("ASSESSMENT_SUBMITTED");
        call(put("/api/patient/assessments/" + id), p.token, assessmentBody(0, 70)).andExpect(status().isConflict());

        // Patients cannot approve (no access to /api/therapist); other therapists cannot see it; admins cannot decide.
        call(post("/api/therapist/assessments/" + id + "/approve"), p.token, Map.of()).andExpect(status().isForbidden());
        call(post("/api/therapist/assessments/" + id + "/approve"), otherTherapist, Map.of()).andExpect(status().isNotFound());
        call(post("/api/therapist/assessments/" + id + "/approve"), admin, Map.of()).andExpect(status().isForbidden());

        // Revision request → patient edits → resubmits.
        call(post("/api/therapist/assessments/" + id + "/request-revision"), therapist, Map.of()).andExpect(status().isBadRequest());
        call(post("/api/therapist/assessments/" + id + "/request-revision"), therapist, Map.of("comment", "Measure seated, please"))
                .andExpect(jsonPath("$.status").value("REVISION_REQUESTED"));
        assertThat(types(read(call(get("/api/notifications"), p.token, null)))).contains("ASSESSMENT_REVISION_REQUESTED");
        call(put("/api/patient/assessments/" + id), p.token, assessmentBody(0, 60)).andExpect(status().isOk());
        call(post("/api/patient/assessments/" + id + "/submit"), p.token, null).andExpect(jsonPath("$.status").value("PENDING_REVIEW"));

        // Therapist correction: new THERAPIST_MEASURED value, original kept and superseded.
        JsonNode current = read(call(get("/api/therapist/assessments/" + id), therapist, null));
        long originalId = measurement(current, kneeRomParam).get("id").asLong();
        JsonNode corrected = read(call(post("/api/therapist/assessments/" + id + "/corrections"), therapist, Map.of(
                "correctsMeasurementId", originalId, "exerciseId", kneeId, "parameterId", kneeRomParam,
                "valueMin", 0, "valueMax", 65, "note", "Goniometer in clinic")).andExpect(status().isOk()));
        List<JsonNode> romRows = measurements(corrected, kneeRomParam);
        assertThat(romRows).hasSize(2);
        assertThat(romRows.stream().filter(m -> m.get("superseded").asBoolean()).findFirst().orElseThrow().get("source").asText())
                .isEqualTo("PATIENT_REPORTED");
        assertThat(romRows.stream().filter(m -> !m.get("superseded").asBoolean()).findFirst().orElseThrow().get("source").asText())
                .isEqualTo("THERAPIST_MEASURED");

        call(post("/api/therapist/assessments/" + id + "/approve"), therapist, Map.of("comment", "Baseline confirmed"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("APPROVED")).andExpect(jsonPath("$.isBaseline").value(true));

        // Approved = immutable for everyone.
        call(put("/api/patient/assessments/" + id), p.token, assessmentBody(0, 90)).andExpect(status().isConflict());
        call(post("/api/therapist/assessments/" + id + "/corrections"), therapist, Map.of("exerciseId", kneeId,
                "parameterId", kneeRepsParam, "value", 3, "note", "late")).andExpect(status().isConflict());
        call(post("/api/therapist/assessments/" + id + "/approve"), therapist, Map.of()).andExpect(status().isConflict());

        // Later assessments are stored separately as follow-ups.
        call(get("/api/patient/assessment-status"), p.token, null)
                .andExpect(jsonPath("$.status").value("APPROVED")).andExpect(jsonPath("$.baselineAssessmentId").value(id))
                .andExpect(jsonPath("$.nextType").value("FOLLOW_UP"));
        call(post("/api/patient/assessments"), p.token, Map.of("type", "INITIAL")).andExpect(status().isConflict());
        call(post("/api/patient/assessments"), p.token, Map.of()).andExpect(jsonPath("$.type").value("FOLLOW_UP"));

        // Audit trail of the assessment, visible to patient and therapist.
        List<String> actions = new ArrayList<>();
        read(call(get("/api/therapist/assessments/" + id + "/history"), therapist, null)).forEach(h -> actions.add(h.get("action").asText()));
        assertThat(actions).containsSubsequence("ASSESSMENT_SUBMITTED", "ASSESSMENT_REVISION_REQUESTED", "ASSESSMENT_REVISED",
                "ASSESSMENT_RESUBMITTED", "ASSESSMENT_MEASUREMENT_CORRECTED", "ASSESSMENT_APPROVED");
        call(get("/api/patient/assessments/" + id + "/history"), p.token, null).andExpect(status().isOk());
        // Another patient cannot read it.
        call(get("/api/patient/assessments/" + id), newPatient(true).token, null).andExpect(status().isNotFound());
    }

    @Test
    void submissionWithoutTherapistWaitsUntilAdminAssignsOne() throws Exception {
        Patient p = newPatient(false);
        long id = read(call(post("/api/patient/assessments"), p.token, Map.of())).get("id").asLong();
        call(put("/api/patient/assessments/" + id), p.token, assessmentBody(0, 50)).andExpect(status().isOk());
        call(post("/api/patient/assessments/" + id + "/submit"), p.token, null).andExpect(jsonPath("$.status").value("SUBMITTED"));

        call(put("/api/admin/patients/" + p.id + "/therapist"), admin, Map.of("therapistId", therapistId)).andExpect(status().isOk());
        call(get("/api/patient/assessments/" + id), p.token, null).andExpect(jsonPath("$.status").value("PENDING_REVIEW"));
        JsonNode pending = read(call(get("/api/therapist/assessments/pending"), therapist, null));
        assertThat(find(pending, "id", id)).isNotNull();
    }

    // ================================================================== prescription → performance → progress

    @Test
    void targetsApprovalPerformanceAndProgressComparison() throws Exception {
        Patient p = newPatient(true);
        approvedBaseline(p, 0, 65, 3);

        // Targets are validated against the parameter's possible values.
        call(post("/api/therapist/patients/" + p.id + "/assignments"), therapist,
                kneePrescription(List.of(target(kneeRomParam, null, 0.0, 500.0)))).andExpect(status().isBadRequest());
        JsonNode rx = read(call(post("/api/therapist/patients/" + p.id + "/assignments"), therapist, kneePrescription(List.of(
                target(kneeRomParam, null, 0.0, 120.0), target(kneeRepsParam, 10.0, null, null)))).andExpect(status().isCreated()));
        long rxId = rx.get("id").asLong();
        assertThat(rx.get("targets")).hasSize(2);
        assertThat(rx.get("safetyInstructions").asText()).isEqualTo("Stop if pain exceeds 5/10");

        // Not approved yet: the patient cannot log performance; patients can never change targets.
        call(post("/api/patient/performances"), p.token, perf(rxId, 0, 80, 8, 2)).andExpect(status().isConflict());
        call(put("/api/therapist/assignments/" + rxId), p.token, kneePrescription(List.of())).andExpect(status().isForbidden());
        // Only the treating therapist approves (not another therapist, not an admin).
        call(post("/api/therapist/assignments/" + rxId + "/approve"), otherTherapist, Map.of("readinessConfirmed", true))
                .andExpect(status().isNotFound());
        call(post("/api/therapist/assignments/" + rxId + "/approve"), admin, Map.of("readinessConfirmed", true))
                .andExpect(status().isForbidden());
        call(post("/api/therapist/assignments/" + rxId + "/approve"), therapist, Map.of("readinessConfirmed", true))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("ACTIVE"));
        assertThat(types(read(call(get("/api/notifications"), p.token, null)))).contains("PRESCRIPTION_APPROVED");

        // Patient logs performance; impossible values rejected; another patient cannot use this prescription.
        call(post("/api/patient/performances"), p.token, perf(rxId, 0, 999, 8, 2)).andExpect(status().isBadRequest());
        call(post("/api/patient/performances"), newPatient(true).token, perf(rxId, 0, 80, 8, 2)).andExpect(status().isNotFound());
        JsonNode entry = read(call(post("/api/patient/performances"), p.token, perf(rxId, 0, 90, 8, 2)).andExpect(status().isCreated()));
        assertThat(entry.get("source").asText()).isEqualTo("PATIENT_REPORTED");
        assertThat(entry.get("flagged").asBoolean()).isFalse();

        // High pain is flagged and the therapist is notified.
        JsonNode painful = read(call(post("/api/patient/performances"), p.token, perf(rxId, 0, 85, 6, 8)).andExpect(status().isCreated()));
        assertThat(painful.get("flagged").asBoolean()).isTrue();
        assertThat(types(read(call(get("/api/notifications"), therapist, null)))).contains("PERFORMANCE_FLAGGED");

        // Therapist feedback reaches the patient.
        call(put("/api/therapist/performances/" + entry.get("id").asLong() + "/feedback"), therapist, Map.of("feedback", "Good range"))
                .andExpect(jsonPath("$.therapistFeedback").value("Good range"));
        call(put("/api/therapist/performances/" + entry.get("id").asLong() + "/feedback"), otherTherapist, Map.of("feedback", "x"))
                .andExpect(status().isNotFound());
        assertThat(types(read(call(get("/api/notifications"), p.token, null)))).contains("PERFORMANCE_FEEDBACK");

        // Progress: ROM baseline span 65 → target 120, latest 85 → (85−65)/(120−65) = 36.4 %, 35° remaining.
        JsonNode progress = read(call(get("/api/therapist/patients/" + p.id + "/rehab-progress"), therapist, null).andExpect(status().isOk()));
        JsonNode rxRow = find(progress.get("prescriptions"), "assignmentId", rxId);
        JsonNode romRow = find(rxRow.get("parameters"), "parameterId", kneeRomParam);
        assertThat(romRow.at("/baseline/valueMax").asDouble()).isEqualTo(65.0);
        assertThat(romRow.get("targetComparable").asDouble()).isEqualTo(120.0);
        assertThat(romRow.get("latestComparable").asDouble()).isEqualTo(85.0);
        assertThat(romRow.get("remaining").asDouble()).isEqualTo(35.0);
        assertThat(romRow.get("progressPct").asDouble()).isEqualTo(36.4);
        assertThat(romRow.get("history")).hasSize(2);
        // Reps: baseline 3 → target 10, latest 6 → 42.9 %.
        assertThat(find(rxRow.get("parameters"), "parameterId", kneeRepsParam).get("progressPct").asDouble()).isEqualTo(42.9);
        assertThat(rxRow.get("latestPain").asInt()).isEqualTo(8);
        assertThat(rxRow.get("attention").toString()).contains("High pain");
        assertThat(progress.get("sources").toString()).contains("PATIENT_REPORTED", "THERAPIST_MEASURED");
        assertThat(progress.get("disclaimer").asText()).contains("not a diagnosis");
        // The patient sees the same comparison for themselves; other therapists cannot.
        call(get("/api/patient/rehab-progress"), p.token, null).andExpect(status().isOk())
                .andExpect(jsonPath("$.patientId").value(p.id));
        call(get("/api/therapist/patients/" + p.id + "/rehab-progress"), otherTherapist, null).andExpect(status().isNotFound());

        // Reports freeze the comparison.
        JsonNode report = read(call(post("/api/therapist/patients/" + p.id + "/reports"), therapist,
                Map.of("from", LocalDate.now().minusDays(7).toString(), "to", LocalDate.now().toString())).andExpect(status().isCreated()));
        assertThat(report.at("/measurements/rehabProgress/prescriptions")).isNotEmpty();
    }

    @Test
    void zeroBaselineGivesNoMisleadingPercentage() throws Exception {
        Patient p = newPatient(true);
        approvedBaseline(p, 0, 40, 0); // 0 repetitions at baseline
        long rxId = approvedKneePrescription(p, List.of(target(kneeRepsParam, 10.0, null, null)));
        call(post("/api/patient/performances"), p.token, perf(rxId, 0, 50, 4, 1)).andExpect(status().isCreated());
        JsonNode row = find(find(read(call(get("/api/patient/rehab-progress"), p.token, null)).get("prescriptions"), "assignmentId", rxId)
                .get("parameters"), "parameterId", kneeRepsParam);
        assertThat(row.get("progressPct").isNull()).isTrue();
        assertThat(row.get("progressNote").asText()).contains("zero");
        assertThat(row.get("remaining").asDouble()).isEqualTo(6.0);
    }

    @Test
    void computerVisionSessionsFeedThePerformanceHistory() throws Exception {
        Patient p = newPatient(true);
        long shoulder = exerciseNamed(therapist, "Shoulder Raise").get("id").asLong();
        long rxId = read(call(post("/api/therapist/patients/" + p.id + "/assignments"), therapist,
                Map.of("exerciseId", shoulder, "targetReps", 8))).get("id").asLong();
        call(post("/api/sessions"), p.token, Map.of("exerciseId", shoulder, "assignmentId", rxId)).andExpect(status().isConflict());
        call(post("/api/therapist/assignments/" + rxId + "/approve"), therapist, Map.of("readinessConfirmed", true)).andExpect(status().isOk());
        long sessionId = read(call(post("/api/sessions"), p.token, Map.of("exerciseId", shoulder, "assignmentId", rxId))
                .andExpect(status().isCreated())).get("id").asLong();
        call(post("/api/sessions/" + sessionId + "/complete"), p.token, Map.of("roundsCompleted", 8, "correctReps", 6,
                "durationSeconds", 90, "metrics", Map.of("meanPeakAbductionDeg", 84.5), "errorCounts", Map.of("ELBOW_BENT", 2)))
                .andExpect(status().isOk());

        JsonNode entries = read(call(get("/api/therapist/patients/" + p.id + "/performances"), therapist, null));
        JsonNode cv = find(entries, "sessionId", sessionId);
        assertThat(cv.get("source").asText()).isEqualTo("COMPUTER_VISION");
        assertThat(cv.get("automated").asBoolean()).isTrue();
        assertThat(cv.at("/cvDetails/clinicallyValidated").asBoolean()).isFalse();
        assertThat(cv.at("/cvDetails/classifications/ELBOW_BENT").asInt()).isEqualTo(2);
        assertThat(cv.get("repsCompleted").asInt()).isEqualTo(8);
        List<String> codes = new ArrayList<>();
        cv.get("measurements").forEach(m -> codes.add(m.get("code").asText() + "=" + m.get("value").asDouble() + "/" + m.get("source").asText()));
        assertThat(codes).contains("abduction_peak=84.5/COMPUTER_VISION", "repetitions=8.0/COMPUTER_VISION");
        // Automated results never change the prescription.
        JsonNode rx = find(read(call(get("/api/therapist/patients/" + p.id + "/assignments"), therapist, null)), "id", rxId);
        assertThat(rx.get("targetReps").asInt()).isEqualTo(8);
    }

    // ================================================================== YouTube suggestions

    @Test
    void youtubeSuggestionReviewAndResourcesStayIndependentOfPrescriptionApproval() throws Exception {
        Patient p = newPatient(true);

        call(post("/api/patient/video-submissions"), p.token, Map.of("url", "https://vimeo.com/123456")).andExpect(status().isBadRequest());
        call(post("/api/patient/video-submissions"), p.token, Map.of("url", "<iframe src=\"https://youtube.com/embed/dQw4w9WgXcQ\">"))
                .andExpect(status().isBadRequest());
        JsonNode sub = read(call(post("/api/patient/video-submissions"), p.token, Map.of(
                "url", "https://youtu.be/dQw4w9WgXcQ?t=10", "exerciseId", kneeId,
                "description", "Knee bends on a chair", "reason", "Looks gentle")).andExpect(status().isCreated()));
        long subId = sub.get("id").asLong();
        assertThat(sub.get("status").asText()).isEqualTo("PENDING");
        assertThat(sub.get("youtubeVideoId").asText()).isEqualTo("dQw4w9WgXcQ");
        assertThat(sub.get("embedUrl").asText()).isEqualTo("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0");
        assertThat(sub.get("thumbnailUrl").asText()).isEqualTo("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
        call(post("/api/patient/video-submissions"), p.token, Map.of("url", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"))
                .andExpect(status().isConflict());

        JsonNode notification = first(read(call(get("/api/notifications?unreadOnly=true"), therapist, null)), "type", "VIDEO_SUBMITTED");
        assertThat(notification.get("title").asText()).contains("Pat");
        assertThat(notification.get("message").asText()).contains("youtube.com/watch?v=dQw4w9WgXcQ", "Seated Knee Flexion", "Knee bends on a chair");
        assertThat(notification.get("link").asText()).isEqualTo("/therapist/videos/" + subId);

        // Notifications belong to their recipient.
        call(put("/api/notifications/" + notification.get("id").asLong() + "/read"), p.token, null).andExpect(status().isNotFound());
        long unread = read(call(get("/api/notifications/unread-count"), therapist, null)).get("unread").asLong();
        call(put("/api/notifications/" + notification.get("id").asLong() + "/read"), therapist, null).andExpect(jsonPath("$.read").value(true));
        assertThat(read(call(get("/api/notifications/unread-count"), therapist, null)).get("unread").asLong()).isEqualTo(unread - 1);

        // Review rights: only the assigned therapist; reason required for reject/revision.
        call(post("/api/therapist/videos/submissions/" + subId + "/approve"), otherTherapist, Map.of()).andExpect(status().isNotFound());
        call(post("/api/therapist/videos/submissions/" + subId + "/approve"), admin, Map.of()).andExpect(status().isForbidden());
        call(post("/api/therapist/videos/submissions/" + subId + "/approve"), p.token, Map.of()).andExpect(status().isForbidden());
        call(post("/api/therapist/videos/submissions/" + subId + "/reject"), therapist, Map.of()).andExpect(status().isBadRequest());

        call(post("/api/therapist/videos/submissions/" + subId + "/request-revision"), therapist, Map.of("reason", "Find one filmed from the side"))
                .andExpect(jsonPath("$.status").value("REVISION_REQUESTED"));
        assertThat(types(read(call(get("/api/notifications"), p.token, null)))).contains("VIDEO_REVISION_REQUESTED");
        call(put("/api/patient/video-submissions/" + subId), p.token, Map.of("url", "https://www.youtube.com/shorts/abcdefghijk",
                "exerciseId", kneeId, "description", "Side view")).andExpect(jsonPath("$.status").value("PENDING"))
                .andExpect(jsonPath("$.youtubeVideoId").value("abcdefghijk"));

        JsonNode approved = read(call(post("/api/therapist/videos/submissions/" + subId + "/approve"), therapist,
                Map.of("feedback", "Good example", "instructions", "Watch before your session")).andExpect(status().isOk()));
        assertThat(approved.get("status").asText()).isEqualTo("APPROVED");
        List<String> transitions = new ArrayList<>();
        approved.get("history").forEach(h -> transitions.add(h.get("toStatus").asText()));
        assertThat(transitions).containsExactly("PENDING", "REVISION_REQUESTED", "PENDING", "APPROVED");
        call(post("/api/therapist/videos/submissions/" + subId + "/reject"), therapist, Map.of("reason", "x")).andExpect(status().isConflict());

        // Approved video is a resource for the patient …
        JsonNode videos = read(call(get("/api/patient/videos"), p.token, null));
        assertThat(videos.get("resources")).hasSize(1);
        assertThat(videos.at("/resources/0/video/youtubeVideoId").asText()).isEqualTo("abcdefghijk");
        assertThat(videos.at("/resources/0/notice").asText()).contains("Educational resource only");
        assertThat(types(read(call(get("/api/notifications"), p.token, null)))).contains("VIDEO_APPROVED");
        // … but it does not authorise the movement: the knee exercise is still not in the program.
        call(get("/api/assignments"), p.token, null).andExpect(jsonPath("$.length()").value(0));
        call(post("/api/patient/performances"), p.token, perf(999999, 0, 50, 5, 1)).andExpect(status().isNotFound());

        // Therapist removes the resource; another patient never sees it.
        long resourceId = videos.at("/resources/0/id").asLong();
        call(delete("/api/therapist/video-resources/" + resourceId), otherTherapist, null).andExpect(status().isNotFound());
        call(delete("/api/therapist/video-resources/" + resourceId), therapist, null).andExpect(status().isNoContent());
        assertThat(read(call(get("/api/patient/videos"), p.token, null)).get("resources")).isEmpty();
        call(get("/api/therapist/videos/submissions/" + subId), otherTherapist, null).andExpect(status().isNotFound());
        assertThat(read(call(get("/api/therapist/videos/history"), therapist, null))).isNotEmpty();
    }

    // ================================================================== exercise library

    @Test
    void libraryEditsNeverChangeExistingPrescriptions() throws Exception {
        Patient p = newPatient(true);
        Map<String, Object> body = new HashMap<>(Map.of("name", "Wall Slide", "defaultReps", 8, "category", "Upper limb",
                "difficultyLevel", "MODERATE", "instructions", "Slide both arms up the wall.",
                "parameters", List.of(Map.of("code", "flexion_peak", "label", "Shoulder flexion", "measurementType", "ANGLE",
                        "unit", "deg", "minValid", 0, "maxValid", 200, "normalMin", 0, "normalMax", 180))));
        call(post("/api/therapist/library/exercises"), p.token, body).andExpect(status().isForbidden());
        JsonNode ex = read(call(post("/api/therapist/library/exercises"), therapist, body).andExpect(status().isCreated()));
        long exId = ex.get("id").asLong();
        long paramId = ex.at("/parameters/0/id").asLong();

        long rxId = read(call(post("/api/therapist/patients/" + p.id + "/assignments"), therapist, Map.of("exerciseId", exId,
                "targetReps", 8, "targets", List.of(Map.of("parameterId", paramId, "targetValue", 150))))).get("id").asLong();

        // Edit the library: new instructions and label; the prescription keeps its copies.
        Map<String, Object> edited = new HashMap<>(body);
        edited.put("instructions", "Changed instructions");
        edited.put("parameters", List.of(Map.of("id", paramId, "code", "flexion_peak", "label", "Flexion (renamed)",
                "measurementType", "ANGLE", "unit", "deg", "minValid", 0, "maxValid", 200, "normalMin", 0, "normalMax", 180)));
        call(put("/api/therapist/library/exercises/" + exId), therapist, edited).andExpect(status().isOk());
        JsonNode rx = find(read(call(get("/api/therapist/patients/" + p.id + "/assignments"), therapist, null)), "id", rxId);
        assertThat(rx.get("instructions").asText()).isEqualTo("Slide both arms up the wall.");
        assertThat(rx.at("/targets/0/label").asText()).isEqualTo("Shoulder flexion");

        // Changing a parameter's unit is refused (recorded values depend on it).
        Map<String, Object> badUnit = new HashMap<>(body);
        badUnit.put("parameters", List.of(Map.of("id", paramId, "code", "flexion_peak", "label", "x", "measurementType", "ANGLE", "unit", "rad")));
        call(put("/api/therapist/library/exercises/" + exId), therapist, badUnit).andExpect(status().isBadRequest());

        // Archive: gone from the library and new prescriptions, the existing one is untouched.
        call(put("/api/therapist/library/exercises/" + exId + "/archive"), therapist, null).andExpect(jsonPath("$.active").value(false));
        assertThat(find(read(call(get("/api/exercises"), p.token, null)), "id", exId)).isNull();
        call(post("/api/therapist/patients/" + p.id + "/assignments"), therapist, Map.of("exerciseId", exId, "targetReps", 8))
                .andExpect(status().isNotFound());
        assertThat(find(read(call(get("/api/therapist/patients/" + p.id + "/assignments"), therapist, null)), "id", rxId)).isNotNull();
        call(put("/api/therapist/library/exercises/" + exId + "/restore"), therapist, null).andExpect(jsonPath("$.active").value(true));
    }

    // ================================================================== helpers

    private record Patient(long id, String token) {}

    /** A patient account created by the admin, optionally assigned to {@link #therapist}. */
    private Patient newPatient(boolean assigned) throws Exception {
        Map<String, Object> body = new HashMap<>(Map.of("firstName", "Pat", "lastName", "Patient", "email", unique("pat"),
                "temporaryPassword", "Temp1234", "role", "PATIENT"));
        if (assigned) body.put("therapistId", therapistId);
        JsonNode created = read(call(post("/api/admin/users"), admin, body).andExpect(status().isCreated()));
        return new Patient(created.get("id").asLong(), login(created.get("email").asText(), "Temp1234"));
    }

    private void approvedBaseline(Patient p, double min, double max, double reps) throws Exception {
        long id = read(call(post("/api/patient/assessments"), p.token, Map.of())).get("id").asLong();
        Map<String, Object> body = Map.of("items", List.of(Map.of("exerciseId", kneeId, "painLevel", 3, "independent", true,
                "measurements", List.of(Map.of("parameterId", kneeRomParam, "valueMin", min, "valueMax", max),
                        Map.of("parameterId", kneeRepsParam, "value", reps)))));
        call(put("/api/patient/assessments/" + id), p.token, body).andExpect(status().isOk());
        call(post("/api/patient/assessments/" + id + "/submit"), p.token, null).andExpect(status().isOk());
        // One therapist-measured addition so the comparison reports both sources.
        call(post("/api/therapist/assessments/" + id + "/corrections"), therapist, Map.of("correctsMeasurementId",
                measurement(read(call(get("/api/therapist/assessments/" + id), therapist, null)), kneeRomParam).get("id").asLong(),
                "exerciseId", kneeId, "parameterId", kneeRomParam, "valueMin", min, "valueMax", max, "note", "Confirmed")).andExpect(status().isOk());
        call(post("/api/therapist/assessments/" + id + "/approve"), therapist, Map.of()).andExpect(status().isOk());
    }

    private long approvedKneePrescription(Patient p, List<Map<String, Object>> targets) throws Exception {
        long rxId = read(call(post("/api/therapist/patients/" + p.id + "/assignments"), therapist, kneePrescription(targets))
                .andExpect(status().isCreated())).get("id").asLong();
        call(post("/api/therapist/assignments/" + rxId + "/approve"), therapist, Map.of("readinessConfirmed", true)).andExpect(status().isOk());
        return rxId;
    }

    private Map<String, Object> kneePrescription(List<Map<String, Object>> targets) {
        Map<String, Object> m = new HashMap<>();
        m.put("exerciseId", kneeId);
        m.put("targetReps", 10);
        m.put("setsPerSession", 2);
        m.put("sessionsPerWeek", 5);
        m.put("safetyInstructions", "Stop if pain exceeds 5/10");
        m.put("targets", targets);
        return m;
    }

    private static Map<String, Object> target(long parameterId, Double value, Double min, Double max) {
        Map<String, Object> m = new HashMap<>();
        m.put("parameterId", parameterId);
        m.put("targetValue", value);
        m.put("targetMin", min);
        m.put("targetMax", max);
        return m;
    }

    private Map<String, Object> perf(long rxId, double min, double max, int reps, int pain) {
        return Map.of("assignmentId", rxId, "repsCompleted", reps, "setsCompleted", 2, "painLevel", pain, "difficultyRating", 3,
                "measurements", List.of(Map.of("parameterId", kneeRomParam, "valueMin", min, "valueMax", max),
                        Map.of("parameterId", kneeRepsParam, "value", reps)));
    }

    private Map<String, Object> assessmentBody(double min, double max) {
        return Map.of("patientNotes", "Stiff in the mornings", "items", List.of(Map.of("exerciseId", kneeId, "painLevel", 4,
                "difficultyRating", 3, "independent", true, "limitationNotes", "Cannot bend fully",
                "measurements", List.of(Map.of("parameterId", kneeRomParam, "valueMin", min, "valueMax", max),
                        Map.of("parameterId", kneeRepsParam, "value", 3)))));
    }

    private JsonNode measurement(JsonNode assessment, long parameterId) {
        return measurements(assessment, parameterId).stream().filter(m -> !m.get("superseded").asBoolean()).findFirst().orElseThrow();
    }

    private List<JsonNode> measurements(JsonNode assessment, long parameterId) {
        List<JsonNode> out = new ArrayList<>();
        assessment.get("items").forEach(i -> i.get("measurements").forEach(m -> {
            if (m.get("parameterId").asLong() == parameterId) out.add(m);
        }));
        return out;
    }

    private JsonNode exerciseNamed(String token, String name) throws Exception {
        for (JsonNode e : read(call(get("/api/exercises"), token, null).andExpect(status().isOk()))) {
            if (name.equals(e.get("name").asText())) return e;
        }
        throw new AssertionError(name + " was not seeded by the migration");
    }

    private static long paramId(JsonNode exercise, String code) {
        for (JsonNode p : exercise.get("parameters")) if (code.equals(p.get("code").asText())) return p.get("id").asLong();
        throw new AssertionError("No parameter " + code);
    }

    private static JsonNode find(JsonNode array, String field, long value) {
        for (JsonNode n : array) if (n.path(field).asLong() == value && !n.path(field).isNull()) return n;
        return null;
    }

    private static JsonNode first(JsonNode array, String field, String value) {
        for (JsonNode n : array) if (value.equals(n.path(field).asText())) return n;
        throw new AssertionError("No element with " + field + "=" + value);
    }

    private static List<String> types(JsonNode notifications) {
        List<String> out = new ArrayList<>();
        notifications.forEach(n -> out.add(n.get("type").asText()));
        return out;
    }

    private User createUser(String prefix, User.Role role) {
        User u = new User();
        u.setFirstName(Character.toUpperCase(prefix.charAt(0)) + prefix.substring(1));
        u.setLastName("Tester");
        u.setEmail(unique(prefix));
        u.setRole(role);
        u.setPasswordHash(passwordEncoder.encode(PASSWORD));
        return userRepository.save(u);
    }

    private static String unique(String prefix) {
        return prefix + "-" + UUID.randomUUID() + "@test.local";
    }

    private String login(String email) throws Exception {
        return login(email, PASSWORD);
    }

    private String login(String email, String password) throws Exception {
        return read(call(post("/api/auth/login"), null, Map.of("email", email, "password", password)).andExpect(status().isOk()))
                .get("token").asText();
    }

    private ResultActions call(MockHttpServletRequestBuilder req, String token, Object body) throws Exception {
        if (token != null) req.header("Authorization", "Bearer " + token);
        if (body != null) req.contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body));
        return mvc.perform(req);
    }

    private JsonNode read(ResultActions r) throws Exception {
        return json.readTree(r.andReturn().getResponse().getContentAsString());
    }
}
