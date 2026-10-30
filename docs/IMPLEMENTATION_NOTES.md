# Implementation notes (October 2026 overhaul)

## Bugs found in the original code and fixed

| # | Problem | Effect | Fix |
|---|---|---|---|
| 1 | Circular bean dependency: `SecurityConfig` defined the `PasswordEncoder` that `DeviceApiKeyFilter` needs, while injecting that filter | **Backend could not start at all** | Encoder moved to `PasswordConfig` |
| 2 | Spring Boot 3 requires Java 17; the machine has JDK 11 | `mvn spring-boot:run` fails | Documented prerequisite (JDK 17+) |
| 3 | Session history touched lazy `exercise` outside a transaction (`open-in-view: false`) | `GET /api/sessions` → 500 | Read-only transactions + entity graphs |
| 4 | No ownership checks on complete/report | Any user could read or complete anyone's session (IDOR) | Owner / linked-therapist checks; 404 for others |
| 5 | Unauthenticated requests got 403 (no entry point) | Frontend's "logout on 401" never triggered | JSON 401/403 handlers |
| 6 | Browser posted events to the device-only `/api/device/**` endpoint | Every event rejected | On-device analysis + patient-scoped `/complete` and `/sync` |
| 7 | WebSocket required auth at the HTTP handshake (SockJS cannot send headers); `sockjs-client` also needs a `global` polyfill under Vite | Live channel never connected | Handshake permitted, STOMP CONNECT authenticated, subscriptions owner-checked; browser no longer needs it |
| 8 | Hard-coded `exerciseId=1` link and demo reference angles; no exercise API | No real exercise data in the UI | `GET /api/exercises`, assignments, analysis config from DB |
| 9 | Access token only in memory; "refresh token" was a second access token | Every reload logged the user out; no revocation | Opaque rotating refresh tokens (hashed in DB), reuse detection, logout revocation |
| 10 | Flyway V1 contained `CREATE DATABASE`/`USE`, and the README told users to also run the same DDL by hand | Flyway fails on a hand-created schema | DB/user-only setup script; Flyway owns tables; vendor-specific migration folders |
| 11 | JWT secret had a placeholder default; CORS origin hard-coded | Insecure default; not configurable | Secret required (≥ 32 bytes); origins from env |
| 12 | Generic exception handler did not log | 500s impossible to diagnose | Logged server-side, generic message to client |
| 13 | Completing a session twice hit the unique report constraint | 500 on client retry | Idempotent completion |
| 14 | Devices could heartbeat as other devices and write to any session; `/api/devices` visible to every user | Data integrity / info leak | Device identity checks; THERAPIST/ADMIN only |
| 15 | `@Component` filters were also registered as global servlet filters | Filters ran outside the security chain | Servlet registration disabled |
| 16 | Login email was case-sensitive | "User@x.com" could not log in | Emails normalised to lower case |
| 17 | `DeviceStatus` never stopped the camera stream on unmount | Camera stayed on after leaving the page | Camera adapter with explicit `stop()` |
| 18 | Frames were sent to the Python service once per second | Not real-time | On-device MediaPipe at up to 30 fps |

Found and fixed during this work's own testing: refresh-token reuse revocation was rolled back
by the transaction (fixed with `noRollbackFor`); the speed check missed fast swings that
overshoot into the hold phase; the abduction angle was measured against the same-side
shoulder→hip line (anatomically wrong, now trunk midline); a 5-second GPU warm-up froze the
first frame (now done during "Enable camera"); `finish()` could leave the UI stuck on
"Saving…" if diagnostics threw (now fail-safe).

## Features implemented

- **Backend:** refresh/logout endpoints; profile + password change; exercise catalog with
  per-exercise analysis config; therapist–patient linking and exercise assignments; session
  start (idempotent), complete with on-device summary + event log (idempotent), abort,
  offline sync, events and report endpoints; progress aggregation (totals, per exercise,
  timeline, streak); stale-session sweep; consistent JSON errors with field errors; health
  endpoint; `.env` loading; H2 profile; demo data seeder; Flyway V2 for MySQL.
- **Frontend:** new responsive design system (light/dark, phone bottom navigation); login /
  register with validation; session restore after reload; dashboard with real stats,
  program and trend; exercise library + detail; live session with camera, skeleton overlay,
  HUD, coach captions, voice settings, metrics, simulated and recorded-video inputs; history
  with filters; report with mistakes, measurements and rep timeline; progress page; profile;
  therapist patient list, patient detail, assignment management; offline exercise cache and
  sync queue with an "unsynced" indicator.
- **Computer vision:** MediaPipe Pose Landmarker (local WASM + model, GPU with CPU fallback,
  warm-up, adaptive FPS); shoulder-abduction evaluator with phases, rep counting, 8 error
  types, tracking-quality gating.
- **Voice coach:** FeedbackController (priorities, persistence, cooldowns, refined repeats,
  confirmation after correction, rep and set announcements, tracking prompts) and VoiceCoach
  (single-slot queue, staleness checks, interruption, mute, rate/volume/language/voice,
  latency measurement), Web Speech adapter.

## Files

Created (backend): `config/PasswordConfig.java`, `config/DemoDataSeeder.java`,
`controller/{UserController,ExerciseController,TherapistController,HealthController}.java`,
`dto/{UserDtos,ExerciseDtos,ProgressDtos}.java`, `entity/{ExerciseAssignment,RefreshToken}.java`,
`repository/{ExerciseAssignmentRepository,RefreshTokenRepository}.java`,
`security/{AuthPrincipal,CurrentUser,JsonErrorWriter}.java`,
`service/{UserService,ExerciseService,ProgressService,TherapistService}.java`,
`resources/db/migration/mysql/V2__monitoring_assignments_tokens.sql`,
`resources/db/migration/h2/V1__init_schema.sql`, `src/test/.../ApiIntegrationTest.java`,
`src/test/resources/application-test.yml`, `.env.example`, `.gitignore`.

Modified (backend): `pom.xml` (H2 runtime scope), `application.yml`, `SecurityConfig`,
`WebSocketConfig`, `AuthController`, `SessionController`, `DeviceController`,
`DeviceEventController`, `AuthDtos`, `SessionDtos`, entities `User`, `Exercise`, `Session`,
`SessionEvent`, `SessionReport`, repositories `User/Exercise/Session/SessionReport`,
`JwtService`, `JwtAuthFilter`, `DeviceApiKeyFilter`, `GlobalExceptionHandler`,
`AuthService`, `SessionService`. Moved (unchanged): `db/migration/V1__init_schema.sql` →
`db/migration/mysql/V1__init_schema.sql`.

Created (frontend): `scripts/setup-mediapipe.mjs`; `src/config.js`; `src/api/services.js`;
`src/core/**` (landmarks, geometry, tracking, ErrorDetector, shoulderAbduction, registry,
FeedbackController, VoiceCoach, SessionRecorder, offlineQueue, synthetic pose + demo script,
3 test files); `src/platform/**` (camera, pose, speech, storage, render, sync);
`src/features/monitoring/**` (MonitoringPipeline, useExerciseSession, VoiceSettingsPanel,
voiceSettings); `src/components/{Layout,ui,ExerciseCard,ProgressChart,ProgressView}.jsx`;
`src/lib/{format,useApi,validation}.js`; pages `Exercises`, `ExerciseDetail`, `Progress`,
`Profile`, `therapist/Patients`, `therapist/PatientDetail`.

Modified (frontend): `package.json` (+ `@mediapipe/tasks-vision`, `vitest`; − `@stomp/stompjs`,
`sockjs-client`), `.env.example`, `.gitignore`, `index.html`, `src/index.css`, `App.jsx`,
`api/client.js`, `context/AuthContext.jsx`, pages `Login`, `Register`, `Dashboard`,
`LiveSession`, `History`, `Report`. Removed: `components/{DeviceStatus,FeedbackToast,SessionControls}.jsx`
(superseded by the camera adapter and live page).

Other: `README.md`, `database/schema.sql` (now DB/user setup only), `docs/ARCHITECTURE.md`
(updated), `docs/EXERCISE_ANALYSIS.md`, `docs/MOBILE_MIGRATION.md`, this file.
`ai-service/` and `edge-device/` are unchanged.

## Test results

### Passed

| Test | Result |
|---|---|
| Backend compile (JDK 21) | OK |
| Backend integration tests (`mvn test`, H2, real security chain + Flyway) | **9/9 passed**: register/login/refresh rotation/reuse revocation/logout; 401/400/409 error shapes + field errors; profile + password change revokes tokens; exercise config; full session lifecycle incl. idempotent start/complete, events, report, progress, abort, validation; offline sync idempotency; cross-user access → 404, role checks → 403; therapist link/assign/review incl. other-therapist isolation; device may only write to its own sessions |
| MySQL 8.0.46 (throwaway instance on port 3307, not your MySQL80 service) | Flyway V1 + V2 applied; Hibernate `validate` passed; API smoke test (login, assignments, start, complete, report, progress, 401, CORS preflight) |
| Frontend `npm run build` | OK (MediaPipe in a separate lazy chunk) |
| Frontend `npm run lint` | 0 errors, 0 warnings |
| Frontend unit tests (`npm test`) | **26/26 passed**: rep counting (clean, too low, no hold), each error type, side-specific messages, glitch rejection, tracking loss (no corrections, rep abandoned), config overrides; voice loop: one correction while an error persists, refined repeats capped at 3, confirmation after correction, rep/set announcements, positioning prompt only while untracked, stale queued correction dropped, interruption, mute keeps captions, latency measurement; recorder summary + paused time; offline queue retry/de-dup/drop-invalid |
| Browser (Claude desktop's embedded Chromium, Windows) | Login validation, wrong-password error, login, dashboard with MySQL data; "no camera" error path; MediaPipe loaded from local WASM + model on the GPU delegate; **real inference on MediaPipe's sample photo** (`pose.jpg`, arms horizontal): 33 landmarks, tracking quality 0.99, measured abduction 89.8° / 96.6°; steady-state inference ≈ 83 ms/frame in that browser; first-frame time 5.1 s before / 16–20 ms after the warm-up fix; simulated session through the real UI: 6/8 counted, 4 correct (matches the script), speech engine actually started 18 utterances (detection-to-speech 597 ms mean, 2021 ms p95, including queueing behind previous sentences), saved, report rendered; **offline**: backend stopped → exercise from cache, session queued on device → backend restarted → queue synced via refresh-token + `/sessions/sync`, row verified in MySQL; phone width 375 px (no horizontal overflow); therapist patient list, detail, assignment form validation + creation |

### Not performed (and why)

- **Live webcam with a person moving**: the test browser has no camera. Real-time camera
  processing with a real patient has **not** been tested.
- **Recorded-video input**: no suitable exercise video was available.
- **Any phone / mobile hardware, Firefox, Safari**: not available. Voice latency on mobile is unmeasured.
- **Audible speech quality**: TTS start events fired, but no person listened to the output.
- **Engine-only voice latency in the browser**: added after the browser run; covered by a unit test only.
- **Your MySQL80 service**: credentials unknown, so a separate throwaway instance was used.
- **Python `ai-service` / `edge-device`**: Python is not installed; code unchanged.
- **Clinical validation** of thresholds: requires a physiotherapist and recorded patient data.

## Remaining limitations

- Exercise thresholds are not clinically validated; only one exercise has an analyzer.
- Inference runs on the main thread (Web Worker / native SDK are next steps).
- Coaching phrases are English only (language/voice selection exists, translations do not).
- Abduction is measured in the image plane: the patient must face the camera with the phone upright.
- Therapist/admin accounts are created via the seeder or the database; there is no admin UI.
- Times are stored in UTC and shown in the browser's local time; server and clients are assumed to share a time zone for "today"/streak calculations.
- No rate limiting on login; HTTPS must be provided by a reverse proxy in deployment.
