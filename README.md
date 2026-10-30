g# PhysioCoach: AI physiotherapy assistant

React (Vite) + Spring Boot 3 + MySQL 8, with **on-device** MediaPipe pose analysis and a
real-time **voice coach**. A patient opens an assigned exercise, stands in front of the
camera, gets spoken and on-screen corrections while moving, and the session summary is
saved for progress tracking. Therapists assign exercises and review progress.

```
 Browser / future phone app (all analysis on-device)          Spring Boot API          MySQL
 ┌──────────────────────────────────────────────────┐   REST  ┌──────────────────┐    ┌──────┐
 │ camera → MediaPipe Pose → exercise rules →        │ ──────► │ auth (JWT +      │ ─► │      │
 │ feedback policy → TTS voice coach + overlay       │  JSON   │ refresh tokens), │    │      │
 │ session recorder → summary (online or queued)     │ ◄────── │ exercises, plans,│ ◄─ │      │
 └──────────────────────────────────────────────────┘         │ sessions, reports│    └──────┘
                                                              └──────────────────┘
```

Video never leaves the device; only derived metrics (reps, errors, angles, timings) are sent.

**Docs:** [docs/EXERCISE_ANALYSIS.md](docs/EXERCISE_ANALYSIS.md) (computer vision + voice coach) ·
[docs/MOBILE_MIGRATION.md](docs/MOBILE_MIGRATION.md) (Android app status and iOS plan) ·
[docs/IMPLEMENTATION_NOTES.md](docs/IMPLEMENTATION_NOTES.md) (what changed, test results, limitations) ·
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (original design notes) ·
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) (Vercel + Supabase + Render) ·
[docs/PHYSIOTHERAPIST_DASHBOARD.md](docs/PHYSIOTHERAPIST_DASHBOARD.md) (admin dashboard, prescriptions, reports)

> The exercise thresholds are an engineering starting point, **not clinically validated**.
> Have a physiotherapist calibrate them before patients rely on the feedback.

---

## 1. Prerequisites

| Tool | Version | Check | Install (Windows) |
|---|---|---|---|
| JDK | **17 or newer** (Spring Boot 3 does not run on 11) | `java -version` | `winget install Microsoft.OpenJDK.21` |
| Maven | 3.9+ | `mvn -v` | `choco install maven` or https://maven.apache.org |
| Node.js | 20+ (tested with 26) | `node -v` | https://nodejs.org |
| MySQL | 8.0 (optional: H2 needs no install) | `mysql --version` | MySQL Installer |
| Browser | Chrome / Edge / Safari with WebGL2 and a webcam | | |

If `java -version` still shows 11 after installing a newer JDK, set `JAVA_HOME` to the new
JDK (and put `%JAVA_HOME%\bin` first in `PATH`) before running Maven.

## 2. Installation

```bash
cd backend
mvn -q -DskipTests package        # downloads dependencies, compiles
cd ../frontend
npm install                       # also needed once for the MediaPipe runtime
npm run setup:mediapipe           # copies the WASM runtime, downloads the pose models (~15 MB)
```

`npm run dev` / `npm run build` run the MediaPipe setup automatically, so the last command
is only needed to pre-fetch the models.
## 3. Environment configuration
```bash
cp backend/.env.example backend/.env       # Windows: copy backend\.env.example backend\.env
cp frontend/.env.example frontend/.env     # optional; defaults point to localhost
```
`backend/.env` is loaded automatically by Spring Boot (real environment variables win):
| Variable | Meaning |
|---|---|
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | MySQL connection |
| `SPRING_PROFILES_ACTIVE=h2` | use the embedded H2 file database instead of MySQL |
| `SPRING_PROFILES_ACTIVE=postgres` + `DB_*` | Supabase / PostgreSQL (production, see docs/DEPLOYMENT.md) |
| `JWT_SECRET` | ≥ 32 bytes. Generate: `openssl rand -base64 48`. The server refuses to start without it. |
| `JWT_ACCESS_TOKEN_MINUTES`, `JWT_REFRESH_TOKEN_DAYS` | token lifetimes (15 min / 14 days) |
| `CORS_ALLOWED_ORIGINS` | comma-separated frontend origins |
| `SEED_DEMO_DATA`, `DEMO_USER_PASSWORD` | create demo therapist + patient accounts at startup (local only) |
Frontend (`frontend/.env`): `VITE_API_BASE_URL` (default `http://localhost:8080/api`),
`VITE_POSE_MODEL` (`lite` or `full`), `VITE_TARGET_FPS`.
## 4. Database setup
**Option A: MySQL (default).** Create the database and an application user once:
```bash
# edit the password in database/schema.sql first, then:
mysql -u root -p < database/schema.sql
```
Put the same password in `backend/.env` (`DB_PASSWORD`). **Tables are created by Flyway**
on backend startup (`backend/src/main/resources/db/migration/mysql`); do not create them by
hand. Upgrading an existing database applies only the new migration (V2).
**Option B: H2, nothing to install.** Set `SPRING_PROFILES_ACTIVE=h2` in `backend/.env`.
Data is stored in `backend/data/physio.mv.db`; delete that file to reset.
## 5. Start the system
Terminal 1, backend (http://localhost:8080):
```bash
cd backend
mvn spring-boot:run
```
Wait for `Started PhysioAssistantApplication`. With `SEED_DEMO_DATA=true` the log also says
`Seeded demo accounts therapist@demo.local and patient@demo.local`.
Terminal 2, frontend (http://localhost:5173):
```bash
cd frontend
npm run dev
```

Open http://localhost:5173 and sign in:

| Account | Email | Password |
|---|---|---|
| Patient (has an assigned Shoulder Raise program) | `patient@demo.local` | value of `DEMO_USER_PASSWORD` |
| Therapist (linked to that patient) | `therapist@demo.local` | value of `DEMO_USER_PASSWORD` |

Or register a new patient account. Therapist/admin accounts are not self-service; create
one by changing `role` in the `users` table, or use the seeded therapist. The therapist
lands on the **physiotherapist dashboard** (caseload overview) and manages patients,
prescriptions, performance and reports under **Patients**.

## 6. Run a monitored exercise (computer vision + voice)

1. Sign in as the patient → **Start session** on *Shoulder Raise*.
2. **Enable camera** → allow camera access. The pose model loads and warms up (a few seconds the first time).
3. Stand 2–3 m from the camera with head, both hands and hips visible → **Start exercise**.
4. Raise both straight arms sideways to shoulder height, hold ~1 s, lower slowly. Try a mistake
   (bend an elbow, lean sideways, stop low, move fast): the coach speaks the correction once,
   stays quiet while you fix it, then confirms "Good, keep that position."
5. **Finish & save** → report with accuracy, mistakes, measurements and a per-rep timeline.

No camera? Use **No camera? Other input options**:
- **Use a recorded video**: analyses a local video file in the browser (nothing is uploaded).
- **Run simulated demo**: replays a scripted landmark sequence (not a real person) showing
  correct reps, corrections, an incomplete rep and a tracking loss.

Voice settings (mute, speed, volume, language, voice) are on the session page and are
remembered per device. Show **metrics** for live angles, FPS and inference time.

**Phone on the same Wi-Fi:** browsers only allow the camera on `https://` or `localhost`.
For a quick test, run `npm run dev -- --host`, set `VITE_API_BASE_URL=http://<PC-IP>:8080/api`,
add `http://<PC-IP>:5173` to `CORS_ALLOWED_ORIGINS`, and on Android Chrome enable
`chrome://flags/#unsafely-treat-insecure-origin-as-secure` for `http://<PC-IP>:5173`
(development only). Use real HTTPS for anything else.

**Android app (Capacitor):** `cd frontend && npm run android:sync && npm run android:open`
builds the web app into `frontend/android` and opens it in Android Studio. It uses native
TTS and Capacitor Preferences instead of `speechSynthesis`/`localStorage`. Status: the
project syncs, but it has **not been compiled or run on any emulator or device**, and the
backend needs `https://localhost` in `CORS_ALLOWED_ORIGINS`. Details and known gaps:
[docs/MOBILE_MIGRATION.md](docs/MOBILE_MIGRATION.md).

**New exercises from a video (therapists):** sign in as the therapist → **Exercises → New
exercise from video** → choose a video of 3-5 correct repetitions (one person, fixed camera,
same angle patients will use) → **Process video** → check the repetitions/joints found →
**Create exercise**. Patients are then compared with that recording using DTW; see
[docs/EXERCISE_ANALYSIS.md](docs/EXERCISE_ANALYSIS.md#exercises-from-a-reference-video-reference_dtw).
Only joint-angle curves are saved, never the video.

## 7. Tests

```bash
cd backend && mvn test             # 16 API integration tests (H2, full security chain, Flyway)
cd frontend && npm test            # 42 unit tests: evaluators, DTW + reference matching, voice loop, recorder, offline queue
cd frontend && npm run lint        # oxlint
cd frontend && npm run build       # production build
```

### Testing the API by hand

```bash
B=http://localhost:8080/api
TOKEN=$(curl -s -X POST $B/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"patient@demo.local","password":"Demo12345"}' | sed -E 's/.*"token":"([^"]+)".*/\1/')
curl -s $B/assignments -H "Authorization: Bearer $TOKEN"
curl -s -X POST $B/sessions -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"exerciseId":1,"clientSessionId":"manual-1"}'
curl -s -X POST $B/sessions/<id>/complete -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"roundsCompleted":8,"correctReps":6,"durationSeconds":120,"errorCounts":{"ELBOW_BENT":2}}'
curl -s "$B/progress?days=30" -H "Authorization: Bearer $TOKEN"
```

### API overview

| Method & path | Who | Purpose |
|---|---|---|
| `POST /api/auth/register` · `login` · `refresh` · `logout` | public | account, tokens (refresh tokens rotate; reuse revokes all) |
| `GET/PUT /api/users/me`, `PUT /api/users/me/password` | user | profile, password change (signs out other devices) |
| `GET /api/exercises`, `GET /api/exercises/{id}` | user | catalog incl. instructions + `analysisConfig` thresholds |
| `GET /api/assignments` | patient | the patient's active program |
| `POST /api/sessions` | patient | start (idempotent on `clientSessionId`) |
| `POST /api/sessions/{id}/complete` | owner | on-device summary + events → report (idempotent) |
| `POST /api/sessions/{id}/abort` | owner | interrupted session |
| `POST /api/sessions/sync` | patient | upload a session recorded offline (idempotent) |
| `GET /api/sessions`, `/{id}`, `/{id}/report`, `/{id}/events` | owner / their therapist | history and reports |
| `GET /api/progress?days=` | patient | totals, per-exercise, timeline |
| `GET /api/therapist/dashboard` | therapist | caseload overview: patient counts, attention list, sessions, weekly trend |
| `GET /api/therapist/patients?search=&rehabStatus=&accountStatus=`, `POST .../patients` (link), `POST .../patients/new` (create) | therapist | caseload; search by name/email/ID |
| `GET/PUT /api/therapist/patients/{id}`, `PUT .../{id}/account-status` | therapist | profile details, activate/deactivate |
| `GET .../patients/{id}/sessions`, `.../progress`, `.../performance?from=&to=` | therapist | session history and measured performance |
| `GET/POST .../patients/{id}/assignments[?includeHistory=true]`, `PUT /api/therapist/assignments/{id}` (new version), `PUT .../{id}/status`, `DELETE .../{id}` | therapist | exercise prescriptions and their history |
| `GET/POST .../patients/{id}/notes`, `DELETE /api/therapist/notes/{id}` | therapist | private clinical notes |
| `GET/POST .../patients/{id}/reports`, `GET/PUT/DELETE /api/therapist/reports/{id}` | therapist | stored reports + professional assessment + sharing |
| `GET /api/reports`, `GET /api/reports/{id}` | patient | reports shared with the signed-in patient |
| `POST /api/admin/devices`, `/api/device/**`, `/ws` | admin / edge device | original UNO Q edge-device flow |
| `GET /api/health` | public | liveness |

Errors always look like `{timestamp, status, error, message, path[, fieldErrors]}`; 401 =
not signed in / token expired, 403 = wrong role, 404 = not found **or not yours**.

## 8. Troubleshooting

| Symptom | Fix |
|---|---|
| `UnsupportedClassVersionError` / `release version 17 not supported` | Maven is using JDK 11. Install JDK 17+ and set `JAVA_HOME`. |
| `JWT_SECRET is missing or shorter than 32 bytes` | Create `backend/.env` from `.env.example`. |
| `Access denied for user 'physio_app'` | Run `database/schema.sql`; make `DB_PASSWORD` match. |
| `Found non-empty schema ... without schema history table` | Tables were created by hand. Use an empty database and let Flyway create them. |
| `Port 8080 already in use` | Set `SERVER_PORT=8081` in `backend/.env` and update `VITE_API_BASE_URL`. |
| Frontend shows "Cannot reach the server" | Backend not running, wrong `VITE_API_BASE_URL`, or the origin is missing from `CORS_ALLOWED_ORIGINS`. |
| "Camera permission was denied" | Allow the camera in the site settings (lock icon) and press Enable camera again. |
| "The camera only works on https:// or http://localhost" | Open the app via `localhost` or HTTPS (see Phone section). |
| Pose model fails to load | First run needs internet if `npm run setup:mediapipe` could not download the model; check `frontend/public/models`. |
| No voice | Check the Voice coach toggle and system volume; some browsers need a click first (Start does that). Firefox on Linux may have no voices. |
| Low FPS / laggy overlay | Use `VITE_POSE_MODEL=lite`, close other tabs, ensure hardware acceleration is on; the loop lowers its rate automatically. |
| Sessions marked "unsynced" | They were recorded offline and upload automatically when the backend is reachable (or reload the page). |

## 9. Optional legacy components

`ai-service/` (Python/Flask MediaPipe server) and `edge-device/` (Arduino UNO Q agent) are
kept unchanged for the hardware flow. The browser no longer depends on them. An edge
device must start sessions with its `deviceId`; it can only write events to those sessions.


## Project layout

```
backend/    Spring Boot API (Flyway migrations for MySQL and H2, integration tests)
frontend/   React app (+ frontend/android: Capacitor Android project, see docs/MOBILE_MIGRATION.md)
  src/core/       platform-independent analysis, feedback, voice, session, sync logic (+ tests)
  src/platform/   adapters: camera, MediaPipe, speech + storage (web and Capacitor), overlay
  src/features/   monitoring pipeline + session hook
  src/api/        HTTP client (token refresh) and the API contract (services.js)
  src/pages/      screens (patient + therapist)
database/   one-time MySQL database/user script
docs/       analysis, mobile plan, implementation notes, original architecture notes
ai-service/, edge-device/   optional legacy Python components
```
