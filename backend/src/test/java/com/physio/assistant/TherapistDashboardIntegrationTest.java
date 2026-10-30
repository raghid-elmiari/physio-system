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
import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Physiotherapist dashboard, patient management, prescriptions, notes and reports,
 * exercised through the real security chain against H2 with the Flyway migrations.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles({"h2", "test"})
class TherapistDashboardIntegrationTest {

    private static final String PASSWORD = "Secret123";

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired UserRepository userRepository;
    @Autowired PasswordEncoder passwordEncoder;

    private String therapistToken;
    private long shoulderRaiseId;

    @BeforeEach
    void createTherapist() throws Exception {
        User therapist = createUser(uniqueEmail("therapist"), User.Role.THERAPIST);
        therapistToken = login(therapist.getEmail(), PASSWORD);
        shoulderRaiseId = shoulderRaiseId(therapistToken);
    }

    // ------------------------------------------------------------------ patient management

    @Test
    void therapistCreatesEditsSearchesAndDeactivatesPatients() throws Exception {
        JsonNode patient = createPatient(therapistToken, "Grace", "Hopper");
        long patientId = patient.get("id").asLong();
        assertThat(patient.get("rehabStatus").asText()).isEqualTo("ASSESSMENT");
        assertThat(patient.get("accountStatus").asText()).isEqualTo("ACTIVE");

        // The new patient can sign in with the temporary password and is a PATIENT.
        String patientToken = login(patient.get("email").asText(), "Temp1234");
        call(get("/api/users/me"), patientToken, null).andExpect(jsonPath("$.role").value("PATIENT"));

        // Duplicate email is rejected.
        call(post("/api/therapist/patients/new"), therapistToken, newPatientBody("X", "Y", patient.get("email").asText()))
                .andExpect(status().isConflict());

        // Edit profile details.
        call(put("/api/therapist/patients/" + patientId), therapistToken, Map.of(
                "firstName", "Grace", "lastName", "Hopper", "phone", "+961 1 234 567",
                "dateOfBirth", "1980-12-09", "primaryCondition", "Rotator cuff tendinopathy", "rehabStatus", "IN_TREATMENT"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.rehabStatus").value("IN_TREATMENT"))
                .andExpect(jsonPath("$.primaryCondition").value("Rotator cuff tendinopathy"));

        // Search by name, by ID, and filter by status.
        assertThat(read(call(get("/api/therapist/patients?search=hopp"), therapistToken, null))).hasSize(1);
        assertThat(read(call(get("/api/therapist/patients?search=" + patientId), therapistToken, null))).hasSize(1);
        assertThat(read(call(get("/api/therapist/patients?search=nobody-matches"), therapistToken, null))).isEmpty();
        assertThat(read(call(get("/api/therapist/patients?rehabStatus=DISCHARGED"), therapistToken, null))).isEmpty();
        assertThat(read(call(get("/api/therapist/patients?rehabStatus=IN_TREATMENT"), therapistToken, null))).hasSize(1);

        // Deactivation takes effect immediately, even for an unexpired access token.
        call(put("/api/therapist/patients/" + patientId + "/account-status"), therapistToken, Map.of("status", "DISABLED"))
                .andExpect(jsonPath("$.accountStatus").value("DISABLED"));
        call(get("/api/users/me"), patientToken, null).andExpect(status().isUnauthorized());
        call(post("/api/auth/login"), null, Map.of("email", patient.get("email").asText(), "password", "Temp1234"))
                .andExpect(status().isForbidden());

        call(put("/api/therapist/patients/" + patientId + "/account-status"), therapistToken, Map.of("status", "ACTIVE"))
                .andExpect(status().isOk());
        login(patient.get("email").asText(), "Temp1234");
    }

    @Test
    void therapistsCannotSeeOrChangeOtherTherapistsPatients() throws Exception {
        long patientId = createPatient(therapistToken, "Ada", "Byron").get("id").asLong();
        String otherTherapist = login(createUser(uniqueEmail("other"), User.Role.THERAPIST).getEmail(), PASSWORD);

        call(get("/api/therapist/patients/" + patientId), otherTherapist, null).andExpect(status().isNotFound());
        call(get("/api/therapist/patients/" + patientId + "/performance"), otherTherapist, null).andExpect(status().isNotFound());
        call(get("/api/therapist/patients/" + patientId + "/notes"), otherTherapist, null).andExpect(status().isNotFound());
        call(put("/api/therapist/patients/" + patientId + "/account-status"), otherTherapist, Map.of("status", "DISABLED"))
                .andExpect(status().isNotFound());
        call(post("/api/therapist/patients/" + patientId + "/reports"), otherTherapist,
                Map.of("from", LocalDate.now().minusDays(7).toString(), "to", LocalDate.now().toString()))
                .andExpect(status().isNotFound());
        assertThat(read(call(get("/api/therapist/patients"), otherTherapist, null))).isEmpty();

        // A therapist account is never reachable as a "patient".
        long otherTherapistId = read(call(get("/api/users/me"), otherTherapist, null)).get("id").asLong();
        call(get("/api/therapist/patients/" + otherTherapistId), therapistToken, null).andExpect(status().isNotFound());
    }

    @Test
    void patientsCannotUseTherapistEndpointsAndRoleChangesApplyImmediately() throws Exception {
        String patientToken = login(createPatient(therapistToken, "Pat", "Ient").get("email").asText(), "Temp1234");
        call(get("/api/therapist/dashboard"), patientToken, null).andExpect(status().isForbidden());
        call(get("/api/therapist/patients"), patientToken, null).andExpect(status().isForbidden());

        // Demote a therapist in the database: the still-valid token no longer grants therapist access.
        User demoted = createUser(uniqueEmail("demoted"), User.Role.THERAPIST);
        String demotedToken = login(demoted.getEmail(), PASSWORD);
        call(get("/api/therapist/dashboard"), demotedToken, null).andExpect(status().isOk());
        demoted.setRole(User.Role.PATIENT);
        userRepository.save(demoted);
        call(get("/api/therapist/dashboard"), demotedToken, null).andExpect(status().isForbidden());
    }

    // ------------------------------------------------------------------ prescriptions

    @Test
    void prescriptionLifecycleAndPatientProgram() throws Exception {
        JsonNode patient = createPatient(therapistToken, "Rosa", "Parks");
        long patientId = patient.get("id").asLong();
        String patientToken = login(patient.get("email").asText(), "Temp1234");

        JsonNode prescription = read(call(post("/api/therapist/patients/" + patientId + "/assignments"), therapistToken,
                prescriptionBody(10, 3, 4)).andExpect(status().isCreated()));
        long firstId = prescription.get("id").asLong();
        assertThat(prescription.get("status").asText()).isEqualTo("ACTIVE");
        assertThat(prescription.get("restSeconds").asInt()).isEqualTo(45);
        assertThat(prescription.get("difficulty").asText()).isEqualTo("MODERATE");

        // The prescription appears on the patient's dashboard with every field.
        JsonNode program = read(call(get("/api/assignments"), patientToken, null));
        assertThat(program).hasSize(1);
        assertThat(program.get(0).get("setsPerSession").asInt()).isEqualTo(3);
        assertThat(program.get(0).get("notes").asText()).isEqualTo("Keep elbows straight");

        // Editing creates a new version and keeps the old one as history.
        JsonNode revised = read(call(put("/api/therapist/assignments/" + firstId), therapistToken, prescriptionBody(12, 2, 5))
                .andExpect(status().isOk()));
        long revisedId = revised.get("id").asLong();
        assertThat(revised.get("previousAssignmentId").asLong()).isEqualTo(firstId);
        assertThat(read(call(get("/api/assignments"), patientToken, null)).get(0).get("targetReps").asInt()).isEqualTo(12);

        JsonNode history = read(call(get("/api/therapist/patients/" + patientId + "/assignments?includeHistory=true"), therapistToken, null));
        assertThat(history).hasSize(2);
        assertThat(statusOf(history, firstId)).isEqualTo("REPLACED");
        call(put("/api/therapist/assignments/" + firstId), therapistToken, prescriptionBody(8, 1, 3)).andExpect(status().isConflict());

        // Pause hides it from the patient; resume brings it back; discontinue ends it.
        call(put("/api/therapist/assignments/" + revisedId + "/status"), therapistToken, Map.of("status", "PAUSED"))
                .andExpect(jsonPath("$.status").value("PAUSED"));
        assertThat(read(call(get("/api/assignments"), patientToken, null))).isEmpty();
        call(put("/api/therapist/assignments/" + revisedId + "/status"), therapistToken, Map.of("status", "ACTIVE"));
        assertThat(read(call(get("/api/assignments"), patientToken, null))).hasSize(1);
        call(delete("/api/therapist/assignments/" + revisedId), therapistToken, null).andExpect(status().isNoContent());
        assertThat(read(call(get("/api/assignments"), patientToken, null))).isEmpty();
        assertThat(statusOf(read(call(get("/api/therapist/patients/" + patientId + "/assignments?includeHistory=true"),
                therapistToken, null)), revisedId)).isEqualTo("DISCONTINUED");

        // Validation: end before start, unknown difficulty.
        Map<String, Object> badDates = prescriptionBody(10, 1, 3);
        badDates.put("startDate", LocalDate.now().toString());
        badDates.put("endDate", LocalDate.now().minusDays(1).toString());
        call(post("/api/therapist/patients/" + patientId + "/assignments"), therapistToken, badDates).andExpect(status().isBadRequest());
        Map<String, Object> badDifficulty = prescriptionBody(10, 1, 3);
        badDifficulty.put("difficulty", "EXTREME");
        call(post("/api/therapist/patients/" + patientId + "/assignments"), therapistToken, badDifficulty).andExpect(status().isBadRequest());
    }

    // ------------------------------------------------------------------ dashboard, performance, reports

    @Test
    void dashboardPerformanceAndReportsReflectRecordedSessions() throws Exception {
        JsonNode patient = createPatient(therapistToken, "Marie", "Curie");
        long patientId = patient.get("id").asLong();
        String patientToken = login(patient.get("email").asText(), "Temp1234");
        long prescriptionId = read(call(post("/api/therapist/patients/" + patientId + "/assignments"), therapistToken,
                prescriptionBody(8, 1, 3))).get("id").asLong();

        // Before any session: the patient needs attention (prescription in force, nothing completed).
        JsonNode before = read(call(get("/api/therapist/dashboard"), therapistToken, null).andExpect(status().isOk()));
        assertThat(before.at("/patients/total").asInt()).isEqualTo(1);
        assertThat(before.at("/patients/active").asInt()).isEqualTo(1);
        assertThat(before.at("/patients/needingAttention").asInt()).isEqualTo(1);
        assertThat(before.at("/sessionsDueThisWeek").asInt()).isEqualTo(3);
        assertThat(before.get("weeklyProgress")).hasSize(8);

        // The patient completes one session on the prescription.
        completeSession(patientToken, prescriptionId, 8, 6, Map.of("ELBOW_BENT", 3, "TRUNK_LEAN", 1));

        JsonNode after = read(call(get("/api/therapist/dashboard"), therapistToken, null));
        assertThat(after.at("/patients/needingAttention").asInt()).isZero();
        assertThat(after.at("/completedSessionsLast30Days").asInt()).isEqualTo(1);
        assertThat(after.at("/sessionsCompletedThisWeek").asInt()).isEqualTo(1);
        assertThat(after.at("/sessionsDueThisWeek").asInt()).isEqualTo(2);
        assertThat(after.at("/averageAccuracyLast30Days").asDouble()).isEqualTo(75.0);
        assertThat(after.at("/recentActivity/0/patientName").asText()).isEqualTo("Marie Curie");

        // Performance view for the default range.
        JsonNode performance = read(call(get("/api/therapist/patients/" + patientId + "/performance"), therapistToken, null)
                .andExpect(status().isOk()));
        assertThat(performance.at("/totals/completedSessions").asInt()).isEqualTo(1);
        assertThat(performance.at("/totals/totalReps").asInt()).isEqualTo(8);
        assertThat(performance.at("/totals/correctReps").asInt()).isEqualTo(6);
        assertThat(performance.at("/totals/movementErrorsDetected").asInt()).isEqualTo(4);
        assertThat(performance.at("/exercises/0/commonErrors/0/code").asText()).isEqualTo("ELBOW_BENT");
        assertThat(performance.at("/exercises/0/averageMeasurements/meanPeakAbductionDeg").asDouble()).isEqualTo(84.0);
        assertThat(performance.at("/prescriptions/0/completedSessions").asInt()).isEqualTo(1);
        assertThat(performance.at("/automatedFindings/disclaimer").asText()).contains("not a clinical assessment");

        // Generate a stored report, add the professional assessment, share it.
        Map<String, Object> range = Map.of("from", LocalDate.now().minusDays(13).toString(), "to", LocalDate.now().toString());
        JsonNode report = read(call(post("/api/therapist/patients/" + patientId + "/reports"), therapistToken, range)
                .andExpect(status().isCreated()));
        long reportId = report.get("id").asLong();
        assertThat(report.get("sharedWithPatient").asBoolean()).isFalse();
        assertThat(report.at("/measurements/patient/name").asText()).isEqualTo("Marie Curie");
        assertThat(report.at("/measurements/period/days").asInt()).isEqualTo(14);
        assertThat(report.at("/assessment/observations").isNull()).isTrue();

        // Not shared yet: invisible to the patient.
        assertThat(read(call(get("/api/reports"), patientToken, null))).isEmpty();
        call(get("/api/reports/" + reportId), patientToken, null).andExpect(status().isNotFound());

        call(put("/api/therapist/reports/" + reportId), therapistToken, Map.of(
                "observations", "Good range of motion, elbow control still inconsistent.",
                "recommendations", "Continue current program.",
                "followUpInstructions", "Review in two weeks.",
                "sharedWithPatient", true))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.assessment.observations").value("Good range of motion, elbow control still inconsistent."));

        assertThat(read(call(get("/api/reports"), patientToken, null))).hasSize(1);
        call(get("/api/reports/" + reportId), patientToken, null).andExpect(status().isOk())
                .andExpect(jsonPath("$.assessment.followUpInstructions").value("Review in two weeks."));
        assertThat(read(call(get("/api/therapist/patients/" + patientId + "/reports"), therapistToken, null))).hasSize(1);

        // Another patient can never read it, shared or not.
        String strangerToken = login(createPatient(therapistToken, "Other", "Patient").get("email").asText(), "Temp1234");
        call(get("/api/reports/" + reportId), strangerToken, null).andExpect(status().isNotFound());
        call(get("/api/therapist/reports/" + reportId), strangerToken, null).andExpect(status().isForbidden());

        // Invalid ranges.
        call(post("/api/therapist/patients/" + patientId + "/reports"), therapistToken,
                Map.of("from", LocalDate.now().toString(), "to", LocalDate.now().minusDays(1).toString()))
                .andExpect(status().isBadRequest());
        call(post("/api/therapist/patients/" + patientId + "/reports"), therapistToken,
                Map.of("from", LocalDate.now().toString(), "to", LocalDate.now().plusDays(3).toString()))
                .andExpect(status().isBadRequest());
    }

    @Test
    void clinicalNotesAreScopedToTheirAuthorsPatients() throws Exception {
        long patientId = createPatient(therapistToken, "Alan", "Turing").get("id").asLong();
        JsonNode note = read(call(post("/api/therapist/patients/" + patientId + "/notes"), therapistToken,
                Map.of("text", "Reports less pain on overhead movement.")).andExpect(status().isCreated()));
        assertThat(note.get("writtenByMe").asBoolean()).isTrue();
        call(post("/api/therapist/patients/" + patientId + "/notes"), therapistToken, Map.of("text", " "))
                .andExpect(status().isBadRequest());

        String otherTherapist = login(createUser(uniqueEmail("other"), User.Role.THERAPIST).getEmail(), PASSWORD);
        call(delete("/api/therapist/notes/" + note.get("id").asLong()), otherTherapist, null).andExpect(status().isNotFound());

        assertThat(read(call(get("/api/therapist/patients/" + patientId + "/notes"), therapistToken, null))).hasSize(1);
        call(delete("/api/therapist/notes/" + note.get("id").asLong()), therapistToken, null).andExpect(status().isNoContent());
        assertThat(read(call(get("/api/therapist/patients/" + patientId + "/notes"), therapistToken, null))).isEmpty();
    }

    // ------------------------------------------------------------------ helpers

    private void completeSession(String patientToken, long prescriptionId, int reps, int correct, Map<String, Integer> errors)
            throws Exception {
        JsonNode session = read(call(post("/api/sessions"), patientToken, Map.of(
                "exerciseId", shoulderRaiseId, "assignmentId", prescriptionId, "clientSessionId", UUID.randomUUID().toString()))
                .andExpect(status().isCreated()));
        Map<String, String> messages = new HashMap<>();
        errors.keySet().forEach(code -> messages.put(code, "Message for " + code));
        call(post("/api/sessions/" + session.get("id").asLong() + "/complete"), patientToken, Map.of(
                "roundsCompleted", reps, "correctReps", correct, "durationSeconds", 95,
                "errorCounts", errors, "errorMessages", messages,
                "metrics", Map.of("meanPeakAbductionDeg", 84.0, "trackedFramePct", 97.5),
                "events", List.of(Map.of("eventUid", UUID.randomUUID().toString(), "sequenceNo", 1,
                        "eventTimestamp", LocalDateTime.now().toString(), "eventType", "REP_COMPLETED", "repNumber", 1))))
                .andExpect(status().isOk());
    }

    private JsonNode createPatient(String token, String firstName, String lastName) throws Exception {
        return read(call(post("/api/therapist/patients/new"), token,
                newPatientBody(firstName, lastName, uniqueEmail(firstName.toLowerCase())))
                .andExpect(status().isCreated()));
    }

    private static Map<String, Object> newPatientBody(String firstName, String lastName, String email) {
        return Map.of("firstName", firstName, "lastName", lastName, "email", email, "temporaryPassword", "Temp1234");
    }

    private Map<String, Object> prescriptionBody(int reps, int sets, int perWeek) {
        Map<String, Object> body = new HashMap<>();
        body.put("exerciseId", shoulderRaiseId);
        body.put("targetReps", reps);
        body.put("setsPerSession", sets);
        body.put("sessionsPerWeek", perWeek);
        body.put("durationSeconds", 30);
        body.put("restSeconds", 45);
        body.put("startDate", LocalDate.now().minusDays(2).toString());
        body.put("endDate", LocalDate.now().plusWeeks(6).toString());
        body.put("difficulty", "MODERATE");
        body.put("notes", "Keep elbows straight");
        return body;
    }

    private static String statusOf(JsonNode prescriptions, long id) {
        for (JsonNode p : prescriptions) if (p.get("id").asLong() == id) return p.get("status").asText();
        throw new AssertionError("Prescription " + id + " not in list");
    }

    private long shoulderRaiseId(String token) throws Exception {
        for (JsonNode exercise : read(call(get("/api/exercises"), token, null))) {
            if ("shoulder_abduction_bilateral".equals(exercise.path("analyzerKey").asText())) return exercise.get("id").asLong();
        }
        throw new AssertionError("Shoulder Raise exercise was not seeded by the migration");
    }

    private User createUser(String email, User.Role role) {
        User user = new User();
        user.setFirstName("Test");
        user.setLastName(role.name());
        user.setEmail(email);
        user.setRole(role);
        user.setPasswordHash(passwordEncoder.encode(PASSWORD));
        return userRepository.save(user);
    }

    private String login(String email, String password) throws Exception {
        return read(call(post("/api/auth/login"), null, Map.of("email", email, "password", password))
                .andExpect(status().isOk())).get("token").asText();
    }

    private static String uniqueEmail(String prefix) {
        return prefix + "-" + UUID.randomUUID() + "@test.local";
    }

    private ResultActions call(MockHttpServletRequestBuilder request, String token, Object body) throws Exception {
        if (token != null) request.header("Authorization", "Bearer " + token);
        if (body != null) request.contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body));
        return mvc.perform(request);
    }

    private JsonNode read(ResultActions result) throws Exception {
        return json.readTree(result.andReturn().getResponse().getContentAsString());
    }
}
