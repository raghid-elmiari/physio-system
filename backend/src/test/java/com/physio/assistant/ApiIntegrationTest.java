package com.physio.assistant;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.physio.assistant.entity.Device;
import com.physio.assistant.entity.User;
import com.physio.assistant.repository.DeviceRepository;
import com.physio.assistant.repository.UserRepository;
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

import java.time.LocalDateTime;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * End-to-end API tests: real Spring context, real security filter chain, real Flyway
 * migrations against an in-memory H2 database.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles({"h2", "test"})
class ApiIntegrationTest {

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired UserRepository userRepository;
    @Autowired DeviceRepository deviceRepository;
    @Autowired PasswordEncoder passwordEncoder;

    // ------------------------------------------------------------------ helpers

    private String uniqueEmail() {
        return "user-" + UUID.randomUUID() + "@test.local";
    }

    private JsonNode register(String email) throws Exception {
        String body = json.writeValueAsString(Map.of(
                "firstName", "Ada", "lastName", "Lovelace", "email", email, "password", "Secret123"));
        String res = mvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return json.readTree(res);
    }

    private String token(JsonNode auth) {
        return auth.get("token").asText();
    }

    private ResultActions call(MockHttpServletRequestBuilder req, String token, Object body) throws Exception {
        if (token != null) req.header("Authorization", "Bearer " + token);
        if (body != null) req.contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body));
        return mvc.perform(req);
    }

    private JsonNode read(ResultActions r) throws Exception {
        return json.readTree(r.andReturn().getResponse().getContentAsString());
    }

    private long shoulderRaiseId(String token) throws Exception {
        JsonNode list = read(call(get("/api/exercises"), token, null).andExpect(status().isOk()));
        for (JsonNode e : list) {
            if ("shoulder_abduction_bilateral".equals(e.path("analyzerKey").asText())) return e.get("id").asLong();
        }
        throw new AssertionError("Shoulder Raise exercise was not seeded by the migration");
    }

    private User createUser(String email, User.Role role) {
        User u = new User();
        u.setFirstName("T");
        u.setLastName("User");
        u.setEmail(email);
        u.setRole(role);
        u.setPasswordHash(passwordEncoder.encode("Secret123"));
        return userRepository.save(u);
    }

    /**
     * A registered patient whose physiotherapist has prescribed and approved Shoulder Raise:
     * since the clinical workflow, patients can only start approved prescriptions.
     */
    private String patientWithApprovedShoulderRaise() throws Exception {
        String email = uniqueEmail();
        String patient = token(register(email));
        String therapistEmail = uniqueEmail();
        createUser(therapistEmail, User.Role.THERAPIST);
        String therapist = login(therapistEmail);
        long patientId = read(call(post("/api/therapist/patients"), therapist, Map.of("email", email))
                .andExpect(status().isOk())).get("id").asLong();
        long rx = read(call(post("/api/therapist/patients/" + patientId + "/assignments"), therapist,
                Map.of("exerciseId", shoulderRaiseId(patient), "targetReps", 10)).andExpect(status().isCreated())).get("id").asLong();
        call(post("/api/therapist/assignments/" + rx + "/approve"), therapist, Map.of("readinessConfirmed", true))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("ACTIVE"));
        return patient;
    }

    private String login(String email) throws Exception {
        return token(read(call(post("/api/auth/login"), null, Map.of("email", email, "password", "Secret123"))
                .andExpect(status().isOk())));
    }

    // ------------------------------------------------------------------ auth

    @Test
    void registerLoginProfileAndRefreshRotation() throws Exception {
        String email = uniqueEmail();
        JsonNode reg = register(email);
        assertThat(reg.get("user").get("role").asText()).isEqualTo("PATIENT");
        assertThat(reg.get("expiresInSeconds").asLong()).isPositive();

        // Login is case-insensitive on email
        JsonNode login = read(call(post("/api/auth/login"), null,
                Map.of("email", email.toUpperCase(), "password", "Secret123")).andExpect(status().isOk()));

        call(get("/api/users/me"), token(login), null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.email").value(email));

        // Refresh rotates: the new token works, the old one is now revoked.
        String refresh1 = login.get("refreshToken").asText();
        JsonNode refreshed = read(call(post("/api/auth/refresh"), null, Map.of("refreshToken", refresh1))
                .andExpect(status().isOk()));
        String refresh2 = refreshed.get("refreshToken").asText();
        assertThat(refresh2).isNotEqualTo(refresh1);
        call(post("/api/auth/refresh"), null, Map.of("refreshToken", refresh1)).andExpect(status().isUnauthorized());
        // Reuse of a rotated token revokes the whole family, including refresh2.
        call(post("/api/auth/refresh"), null, Map.of("refreshToken", refresh2)).andExpect(status().isUnauthorized());

        // Logout revokes the token
        String refresh3 = read(call(post("/api/auth/login"), null, Map.of("email", email, "password", "Secret123")))
                .get("refreshToken").asText();
        call(post("/api/auth/logout"), null, Map.of("refreshToken", refresh3)).andExpect(status().isNoContent());
        call(post("/api/auth/refresh"), null, Map.of("refreshToken", refresh3)).andExpect(status().isUnauthorized());
    }

    @Test
    void authErrorsAreConsistentJson() throws Exception {
        call(get("/api/sessions"), null, null)
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.status").value(401))
                .andExpect(jsonPath("$.message").exists());
        call(get("/api/sessions"), "not-a-jwt", null).andExpect(status().isUnauthorized());

        call(post("/api/auth/login"), null, Map.of("email", "nobody@test.local", "password", "whatever1"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.message").value("Invalid email or password"));

        call(post("/api/auth/register"), null, Map.of("firstName", "", "lastName", "X", "email", "bad", "password", "short"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors.email").exists())
                .andExpect(jsonPath("$.fieldErrors.password").exists())
                .andExpect(jsonPath("$.fieldErrors.firstName").exists());

        String email = uniqueEmail();
        register(email);
        call(post("/api/auth/register"), null,
                Map.of("firstName", "A", "lastName", "B", "email", email, "password", "Secret123"))
                .andExpect(status().isConflict());

        mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON).content("{not json"))
                .andExpect(status().isBadRequest());

        call(get("/api/health"), null, null).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("ok"));
    }

    @Test
    void profileUpdateAndPasswordChange() throws Exception {
        String email = uniqueEmail();
        JsonNode reg = register(email);
        String t = token(reg);
        call(put("/api/users/me"), t, Map.of("firstName", "Grace", "lastName", "Hopper"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.firstName").value("Grace"));
        call(put("/api/users/me/password"), t, Map.of("currentPassword", "wrong", "newPassword", "NewSecret456"))
                .andExpect(status().isBadRequest());
        call(put("/api/users/me/password"), t, Map.of("currentPassword", "Secret123", "newPassword", "NewSecret456"))
                .andExpect(status().isNoContent());
        // Old refresh token was revoked by the password change
        call(post("/api/auth/refresh"), null, Map.of("refreshToken", reg.get("refreshToken").asText()))
                .andExpect(status().isUnauthorized());
        call(post("/api/auth/login"), null, Map.of("email", email, "password", "NewSecret456")).andExpect(status().isOk());
    }

    // ------------------------------------------------------------------ exercises & sessions

    @Test
    void exerciseListExposesAnalysisConfig() throws Exception {
        String t = token(register(uniqueEmail()));
        long id = shoulderRaiseId(t);
        call(get("/api/exercises/" + id), t, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.cameraMonitoringSupported").value(true))
                .andExpect(jsonPath("$.analysisConfig.targetAngle").value(80))
                .andExpect(jsonPath("$.instructions").exists());
        call(get("/api/exercises/999999"), t, null).andExpect(status().isNotFound());
    }

    @Test
    void sessionLifecycleWithOnDeviceSummary() throws Exception {
        String t = patientWithApprovedShoulderRaise();
        long exerciseId = shoulderRaiseId(t);
        String clientId = UUID.randomUUID().toString();

        JsonNode started = read(call(post("/api/sessions"), t,
                Map.of("exerciseId", exerciseId, "roundsRequested", 5, "clientSessionId", clientId))
                .andExpect(status().isCreated()));
        long sessionId = started.get("id").asLong();
        assertThat(started.get("status").asText()).isEqualTo("IN_PROGRESS");

        // Retrying the start with the same clientSessionId does not create a duplicate
        JsonNode retried = read(call(post("/api/sessions"), t,
                Map.of("exerciseId", exerciseId, "roundsRequested", 5, "clientSessionId", clientId)));
        assertThat(retried.get("id").asLong()).isEqualTo(sessionId);

        Map<String, Object> summary = Map.of(
                "roundsCompleted", 4,
                "correctReps", 3,
                "durationSeconds", 95,
                "errorCounts", Map.of("ELBOW_BENT", 2, "TRUNK_LEAN", 1),
                "errorMessages", Map.of("ELBOW_BENT", "Keep your elbows straight", "TRUNK_LEAN", "Keep your back straight"),
                "metrics", Map.of("peakAbductionDeg", 92.5, "trackingQuality", 0.91),
                "events", java.util.List.of(
                        Map.of("eventUid", "e1", "sequenceNo", 1, "eventTimestamp", LocalDateTime.now().toString(),
                                "eventType", "REP_COMPLETED", "repNumber", 1, "value", 91.2),
                        Map.of("eventUid", "e2", "sequenceNo", 2, "eventTimestamp", LocalDateTime.now().toString(),
                                "eventType", "ERROR", "errorCode", "ELBOW_BENT", "message", "Keep your elbows straight")));

        call(post("/api/sessions/" + sessionId + "/complete"), t, summary)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accuracyPct").value("75.00"))
                .andExpect(jsonPath("$.correctReps").value(3))
                .andExpect(jsonPath("$.commonMistakes[0].code").value("ELBOW_BENT"))
                .andExpect(jsonPath("$.commonMistakes[0].count").value(2))
                .andExpect(jsonPath("$.metrics.peakAbductionDeg").value(92.5));

        // Completing again (client retry) is idempotent and returns the same report
        call(post("/api/sessions/" + sessionId + "/complete"), t, summary)
                .andExpect(status().isOk()).andExpect(jsonPath("$.accuracyPct").value("75.00"));

        call(get("/api/sessions/" + sessionId + "/report"), t, null)
                .andExpect(status().isOk()).andExpect(jsonPath("$.durationSeconds").value(95));
        call(get("/api/sessions/" + sessionId + "/events"), t, null)
                .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(2));
        call(get("/api/sessions"), t, null)
                .andExpect(status().isOk()).andExpect(jsonPath("$[0].status").value("COMPLETED"));
        call(get("/api/progress"), t, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totals.completedSessions").value(1))
                .andExpect(jsonPath("$.totals.totalReps").value(4))
                .andExpect(jsonPath("$.timeline[0].accuracyPct").value(75.0));

        // correctReps > roundsCompleted is rejected
        long s2 = read(call(post("/api/sessions"), t, Map.of("exerciseId", exerciseId))).get("id").asLong();
        call(post("/api/sessions/" + s2 + "/complete"), t, Map.of("roundsCompleted", 1, "correctReps", 2))
                .andExpect(status().isBadRequest());
        // abort
        call(post("/api/sessions/" + s2 + "/abort"), t, Map.of("roundsCompleted", 1))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("ABORTED"));
    }

    @Test
    void offlineSyncIsIdempotent() throws Exception {
        String t = patientWithApprovedShoulderRaise();
        long exerciseId = shoulderRaiseId(t);
        Map<String, Object> body = Map.of(
                "clientSessionId", "offline-" + UUID.randomUUID(),
                "exerciseId", exerciseId,
                "roundsRequested", 6,
                "startedAt", LocalDateTime.now().minusMinutes(2).toString(),
                "endedAt", LocalDateTime.now().minusMinutes(1).toString(),
                "summary", Map.of("roundsCompleted", 6, "correctReps", 6, "durationSeconds", 60));
        // A session recorded offline before the prescription was approved is refused.
        Map<String, Object> beforeApproval = new java.util.HashMap<>(body);
        beforeApproval.put("clientSessionId", "offline-" + UUID.randomUUID());
        beforeApproval.put("startedAt", LocalDateTime.now().minusHours(2).toString());
        beforeApproval.put("endedAt", LocalDateTime.now().minusHours(1).toString());
        call(post("/api/sessions/sync"), t, beforeApproval).andExpect(status().isConflict());

        JsonNode first = read(call(post("/api/sessions/sync"), t, body).andExpect(status().isOk()));
        JsonNode second = read(call(post("/api/sessions/sync"), t, body).andExpect(status().isOk()));
        assertThat(second.get("sessionId").asLong()).isEqualTo(first.get("sessionId").asLong());
        assertThat(first.get("accuracyPct").asText()).isEqualTo("100.00");
        assertThat(read(call(get("/api/sessions"), t, null)).size()).isEqualTo(1);
    }

    @Test
    void usersCannotAccessOtherUsersSessions() throws Exception {
        String alice = patientWithApprovedShoulderRaise();
        String bob = token(register(uniqueEmail()));
        long exerciseId = shoulderRaiseId(alice);
        long sessionId = read(call(post("/api/sessions"), alice, Map.of("exerciseId", exerciseId))).get("id").asLong();

        call(get("/api/sessions/" + sessionId), bob, null).andExpect(status().isNotFound());
        call(post("/api/sessions/" + sessionId + "/complete"), bob, Map.of("roundsCompleted", 1)).andExpect(status().isNotFound());
        call(post("/api/sessions/" + sessionId + "/abort"), bob, null).andExpect(status().isNotFound());
        call(get("/api/sessions/" + sessionId + "/report"), bob, null).andExpect(status().isNotFound());
        assertThat(read(call(get("/api/sessions"), bob, null)).size()).isZero();

        // Patients cannot use therapist or admin endpoints, or the device ingestion endpoint
        call(get("/api/therapist/patients"), bob, null).andExpect(status().isForbidden());
        call(post("/api/admin/devices"), bob, Map.of("deviceId", "X", "deviceName", "Y")).andExpect(status().isForbidden());
        call(post("/api/device/sessions/" + sessionId + "/events"), bob, Map.of()).andExpect(status().isUnauthorized());
    }

    @Test
    void therapistCreatesExerciseFromReferenceRecording() throws Exception {
        String therapistEmail = uniqueEmail();
        createUser(therapistEmail, User.Role.THERAPIST);
        String therapist = login(therapistEmail);
        String patient = token(register(uniqueEmail()));

        Map<String, Object> reference = Map.of(
                "version", 1, "primary", "left_shoulder", "features", java.util.List.of("left_shoulder", "left_elbow"),
                "restValue", 10, "peakValue", 88,
                "reps", java.util.List.of(Map.of("frames", java.util.List.of(java.util.List.of(10, 178), java.util.List.of(88, 177)), "durationMs", 4000)));
        Map<String, Object> body = Map.of("name", "Side arm raise", "defaultReps", 8, "bodyRegion", "Shoulder",
                "analysisConfig", Map.of("reference", reference));

        // Patients cannot create exercises; a config without a reference is rejected.
        call(post("/api/therapist/exercises"), patient, body).andExpect(status().isForbidden());
        call(post("/api/therapist/exercises"), therapist, Map.of("name", "X", "defaultReps", 8, "analysisConfig", Map.of()))
                .andExpect(status().isBadRequest());

        JsonNode created = read(call(post("/api/therapist/exercises"), therapist, body).andExpect(status().isCreated()));
        long id = created.get("id").asLong();
        assertThat(created.get("analyzerKey").asText()).isEqualTo("reference_dtw");
        assertThat(created.get("cameraMonitoringSupported").asBoolean()).isTrue();

        // Visible to patients, with the reference the device needs.
        call(get("/api/exercises/" + id), patient, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.analysisConfig.reference.primary").value("left_shoulder"))
                .andExpect(jsonPath("$.analysisConfig.reference.reps[0].durationMs").value(4000));

        call(put("/api/therapist/exercises/" + id), therapist, Map.of("name", "Side arm raise v2", "defaultReps", 10,
                "analysisConfig", Map.of("reference", reference)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.name").value("Side arm raise v2"));
        // Built-in rule-based exercises cannot be overwritten through this endpoint.
        call(put("/api/therapist/exercises/" + shoulderRaiseId(patient)), therapist, body).andExpect(status().isBadRequest());
    }

    @Test
    void therapistAssignsAndReviews() throws Exception {
        String therapistEmail = uniqueEmail();
        createUser(therapistEmail, User.Role.THERAPIST);
        String therapist = login(therapistEmail);
        String patientEmail = uniqueEmail();
        JsonNode patientAuth = register(patientEmail);
        String patient = token(patientAuth);
        long patientId = patientAuth.get("user").get("id").asLong();
        long exerciseId = shoulderRaiseId(patient);

        // Not linked yet: therapist cannot see the patient
        call(get("/api/therapist/patients/" + patientId), therapist, null).andExpect(status().isNotFound());
        call(post("/api/therapist/patients"), therapist, Map.of("email", patientEmail)).andExpect(status().isOk());
        call(get("/api/therapist/patients"), therapist, null)
                .andExpect(status().isOk()).andExpect(jsonPath("$[0].email").value(patientEmail));

        JsonNode assignment = read(call(post("/api/therapist/patients/" + patientId + "/assignments"), therapist,
                Map.of("exerciseId", exerciseId, "targetReps", 12, "notes", "Slow and controlled"))
                .andExpect(status().isCreated()));
        long assignmentId = assignment.get("id").asLong();
        assertThat(assignment.get("status").asText()).isEqualTo("PENDING_APPROVAL");

        // Prescribed is not cleared: the patient cannot start until the therapist approves.
        call(post("/api/sessions"), patient, Map.of("exerciseId", exerciseId, "assignmentId", assignmentId))
                .andExpect(status().isConflict());
        call(post("/api/therapist/assignments/" + assignmentId + "/approve"), therapist, Map.of("readinessConfirmed", true))
                .andExpect(status().isOk());

        call(get("/api/assignments"), patient, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].targetReps").value(12))
                .andExpect(jsonPath("$[0].exercise.analyzerKey").value("shoulder_abduction_bilateral"));

        // Starting from the assignment uses its target reps
        JsonNode s = read(call(post("/api/sessions"), patient, Map.of("exerciseId", exerciseId, "assignmentId", assignmentId))
                .andExpect(status().isCreated()));
        assertThat(s.get("roundsRequested").asInt()).isEqualTo(12);
        long sessionId = s.get("id").asLong();
        call(post("/api/sessions/" + sessionId + "/complete"), patient, Map.of("roundsCompleted", 12, "correctReps", 9))
                .andExpect(status().isOk());

        // The linked therapist can read the patient's report and progress; another therapist cannot.
        call(get("/api/sessions/" + sessionId + "/report"), therapist, null)
                .andExpect(status().isOk()).andExpect(jsonPath("$.accuracyPct").value("75.00"));
        call(get("/api/therapist/patients/" + patientId + "/progress"), therapist, null)
                .andExpect(status().isOk()).andExpect(jsonPath("$.totals.completedSessions").value(1));
        String otherEmail = uniqueEmail();
        createUser(otherEmail, User.Role.THERAPIST);
        String other = login(otherEmail);
        call(get("/api/sessions/" + sessionId + "/report"), other, null).andExpect(status().isNotFound());
        call(get("/api/therapist/patients/" + patientId + "/sessions"), other, null).andExpect(status().isNotFound());
        call(post("/api/therapist/patients"), other, Map.of("email", patientEmail)).andExpect(status().isConflict());

        call(delete("/api/therapist/assignments/" + assignmentId), therapist, null).andExpect(status().isNoContent());
        call(get("/api/assignments"), patient, null).andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void deviceCanOnlyWriteToItsOwnSessions() throws Exception {
        String adminEmail = uniqueEmail();
        createUser(adminEmail, User.Role.ADMIN);
        String admin = login(adminEmail);
        String deviceId = "UNOQ-" + UUID.randomUUID().toString().substring(0, 8);
        JsonNode reg = read(call(post("/api/admin/devices"), admin, Map.of("deviceId", deviceId, "deviceName", "Test"))
                .andExpect(status().isOk()));
        String apiKey = reg.get("apiKey").asText();

        String patient = patientWithApprovedShoulderRaise();
        long exerciseId = shoulderRaiseId(patient);
        long unbound = read(call(post("/api/sessions"), patient, Map.of("exerciseId", exerciseId))).get("id").asLong();
        long bound = read(call(post("/api/sessions"), patient, Map.of("exerciseId", exerciseId, "deviceId", deviceId)))
                .get("id").asLong();

        Map<String, Object> event = Map.of("eventUid", "d1", "sequenceNo", 1,
                "eventTimestamp", LocalDateTime.now().toString(), "jointName", "left_elbow",
                "deviationValue", 12.5, "feedbackMessage", "Extend your Left Elbow");
        var withKey = (java.util.function.Function<MockHttpServletRequestBuilder, MockHttpServletRequestBuilder>)
                r -> r.header("X-Device-Id", deviceId).header("X-Api-Key", apiKey);

        call(withKey.apply(post("/api/device/sessions/" + unbound + "/events")), null, event).andExpect(status().isForbidden());
        call(withKey.apply(post("/api/device/sessions/" + bound + "/events")), null, event).andExpect(status().isOk());
        call(withKey.apply(post("/api/device/sessions/" + bound + "/events")), null, event).andExpect(status().isOk()); // idempotent
        call(post("/api/device/sessions/" + bound + "/events").header("X-Device-Id", deviceId).header("X-Api-Key", "wrong"),
                null, event).andExpect(status().isUnauthorized());
        call(withKey.apply(post("/api/device/heartbeat")), null, Map.of("deviceId", "SOMEONE-ELSE")).andExpect(status().isForbidden());
        call(withKey.apply(post("/api/device/heartbeat")), null, Map.of("deviceId", deviceId)).andExpect(status().isOk());

        Device d = deviceRepository.findByDeviceId(deviceId).orElseThrow();
        assertThat(d.getLastSeenAt()).isNotNull();
    }
}
