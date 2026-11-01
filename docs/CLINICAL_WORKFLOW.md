# Clinical workflow: assessments, prescriptions, performance, videos and administration

This document describes the November 2026 extension of PhysioCoach into a personalised
physiotherapy management platform. It builds on the existing stack (React + Spring Boot +
Flyway, MySQL / H2 / PostgreSQL) and the existing entities; nothing was rebuilt.

```
ADMIN creates accounts and assigns each patient to one physiotherapist
  → PATIENT records an initial physical assessment and submits it
  → THERAPIST reviews it (corrects values, requests a revision or approves it): approved = baseline
  → THERAPIST prescribes library exercises with personal targets (status: awaiting approval)
  → THERAPIST confirms readiness and approves the prescription (ACTIVE, or APPROVED until its start date)
  → PATIENT performs it: camera session (computer vision) or a logged entry; both are stored as performance
  → the system compares baseline, target and latest values; THERAPIST reviews, gives feedback, revises
  → PATIENT may suggest YouTube videos; THERAPIST approves them as learning material only
```

## Roles and access

| | Admin | Therapist | Patient |
|---|---|---|---|
| Users, roles, activation, assignments, audit log | yes | no (403) | no (403) |
| Patients' records | all (read) | assigned patients only (others: 404) | own only |
| Approve assessments / prescriptions / videos, resume prescriptions, share videos | no (403) | **assigned patients only** | never |
| Exercise library (create, edit, archive) | yes | yes | read only |
| Assessments, performance logging, video suggestions | – | records on behalf of patients | own |

* Roles: `SecurityConfig` (`/api/admin/**` ADMIN, `/api/therapist/**` THERAPIST or ADMIN,
  `/api/patient/**` PATIENT). Role and account status are read from the database on every request.
* Which patient: `PatientAccessPolicy.requireAccessiblePatient` (caseload) and
  `requireTreatingTherapist` (clinical decisions). IDs in URLs are always checked; patient
  endpoints never accept a patient or therapist ID from the client.
* Records are never deleted by these features: accounts are deactivated, exercises archived,
  library videos and patient resources deactivated, prescriptions discontinued.

## Data model (Flyway V4, all three dialects)

| Table | Purpose |
|---|---|
| `exercises` (+ `category`, `difficulty_level`, `created_by_id`, `updated_at`, `archived_at`) | Global exercise definitions |
| `exercise_parameters` | Configurable measurements per exercise: type (angle, flexibility, repetitions, duration, distance, pain, custom), unit, single value or range, possible range (`min_valid`/`max_valid`, values outside are rejected), expected range (`normal_min`/`normal_max`, values outside are flagged), direction, used in assessments, optional `cv_metric_key` |
| `patient_assessments` → `assessment_items` → `measurements` | Assessments (INITIAL / FOLLOW_UP) with statuses IN_PROGRESS, SUBMITTED, PENDING_REVIEW, APPROVED, REVISION_REQUESTED (NOT_STARTED is reported when none exists). Items hold pain (0–10), difficulty (1–5), independence and limitation notes |
| `exercise_assignments` (+ approval fields, instructions, safety instructions, expected progression, change reason) | Patient-specific prescriptions; statuses PENDING_APPROVAL, APPROVED, ACTIVE, PAUSED, COMPLETED, DISCONTINUED, REPLACED |
| `prescription_targets` | Personal target per parameter (value or range), label and unit copied |
| `exercise_performances` → `measurements` | What was actually done; source PATIENT_REPORTED, THERAPIST_MEASURED or COMPUTER_VISION; optional link to a camera session; therapist feedback |
| `exercise_videos`, `patient_video_resources` | Approved YouTube videos (library or patient-specific) |
| `patient_video_submissions`, `video_review_history` | Patient suggestions and every status change |
| `notifications` | Persistent in-app notifications with read/unread state |
| `audit_logs` | Append-only trail of clinical and administrative changes (before/after details as JSON) |

`measurements` is the single table for measured values, owned by either an assessment item or
a performance entry (a check constraint enforces exactly one). Every row stores its source,
timestamp, recorder, label and unit.

### Integrity rules

* **Baseline**: the most recently approved INITIAL assessment. Approved assessments are
  immutable; later measurements are FOLLOW_UP assessments. A therapist correction is a new
  THERAPIST_MEASURED row pointing to the original (`corrects_id`), which is marked superseded.
* **Prescriptions are versioned** (unchanged design): editing creates a new version and marks
  the old one REPLACED. The treating therapist's edit keeps the prescription in force (their
  edit is the authorisation); an edit by anyone else sends it back to PENDING_APPROVAL.
* **Library edits never touch prescriptions**: instructions and target labels/units are
  copied into the prescription; a parameter's code, type, unit and range shape cannot change
  once created; removed parameters are archived.
* **Nothing increases targets automatically.** Targets change only through a therapist revision.
* **Approval gate**: `POST /api/sessions` (camera) and `POST /api/patient/performances` (manual)
  require an ACTIVE prescription in force today (an APPROVED one becomes ACTIVE on its start
  date at first use). Offline-recorded sessions are accepted only if the prescription was
  approved before the session started. Staff can still try exercises freely.
* **Video approval ≠ exercise approval**: an approved video becomes a resource; it never
  creates or approves a prescription.

## Progress comparison

`RehabProgressService` compares, per prescription and parameter, the baseline, the target, the
latest value and the values in the period (`GET /api/therapist/patients/{id}/rehab-progress`,
`GET /api/patient/rehab-progress`, and frozen into every newly generated report).

* Range measurements are compared by their span (max − min), e.g. 0°–65° → 65.
* Remaining = distance from the latest value (or the baseline) to the target, never negative.
* Progress % = (latest − baseline) ÷ (target − baseline), **only** when a target, a non-zero
  baseline and a recorded value exist and the target differs from the baseline; otherwise the
  reason is shown instead of a number.
* Attention flags: pain ≥ 7, flagged entries, no activity for 7 days on an active
  prescription, under half of the expected entries, latest worse than baseline.
* Every value carries its source; the response states the period and a disclaimer that it is a
  system calculation, not a diagnosis or a claim of recovery.

## Computer vision integration

Camera sessions already run on the device (MediaPipe). When such a session is completed for a
prescription, `PerformanceService.recordFromComputerVision` stores it through the same
performance model:

| Pipeline stage | Where it goes |
|---|---|
| Raw video / frames | Never leaves the device (recorded as such in `cv_details`) |
| Keypoints | Not stored |
| Joint angles (analyzer metrics) | `cv_details.jointAngleMetrics`, and mapped to parameters through `exercise_parameters.cv_metric_key` |
| Model classifications (movement errors) | `cv_details.classifications` |
| Final measurements | `measurements` rows with source COMPUTER_VISION |

Implausible automated values are dropped and the entry flagged; entries are labelled
"not clinically validated"; automated results can never change targets or approve anything.
A future model (OpenCV, TensorFlow Lite, …) only needs to produce metrics keyed like
`cv_metric_key` and complete a session for a prescription.

## YouTube workflow

* Accepted links: `youtube.com/watch?v=`, `youtu.be/`, `youtube.com/shorts/` (and `/embed/`),
  on YouTube hosts only. The 11-character ID is extracted and validated (`YouTubeUrls`, mirrored
  in `frontend/src/lib/youtube.js`); HTML, other hosts and credentials in URLs are rejected.
* Title and channel come from YouTube's public oEmbed endpoint, never from the patient.
  "Video not found" and "cannot be embedded" are rejected; if YouTube is unreachable the
  suggestion is still accepted without a title. Disable with `YOUTUBE_METADATA_ENABLED=false`.
* Thumbnails and embeds are built from the validated ID only
  (`https://www.youtube-nocookie.com/embed/{id}`, no autoplay).
* Statuses PENDING → APPROVED / REJECTED (reason required) / REVISION_REQUESTED (patient can
  resubmit). Every change is in `video_review_history` and the audit log; only the patient's
  assigned therapist can review.

## Notifications

Created inside the transaction of the event that causes them: video submitted / approved /
rejected / revision requested, assessment submitted / approved / revision requested,
prescription approved / changed, performance feedback, high-pain or flagged performance,
patient assigned / therapist assigned. `GET /api/notifications`, `GET .../unread-count`,
`PUT .../{id}/read`, `PUT .../read-all` (recipients only; others get 404). The header bell
polls the unread count every minute.

## API

| Method & path | Role | Purpose |
|---|---|---|
| `GET /api/admin/stats`, `GET /api/admin/users?role=&status=&search=`, `GET /api/admin/users/{id}` | admin | overview and user list |
| `POST /api/admin/users` | admin | create any role (optionally assign a patient) |
| `PUT /api/admin/users/{id}/role`, `PUT /api/admin/users/{id}/status` | admin | change role / activate / deactivate (guarded) |
| `PUT /api/admin/patients/{id}/therapist` | admin | assign, reassign or unassign; pending reviews follow |
| `GET /api/admin/therapists/workload`, `GET /api/admin/audit-logs`, `GET /api/admin/permissions` | admin | workload, audit trail, role model |
| `GET /api/patient/assessment-status`, `GET /api/patient/assessment-exercises` | patient | status and what can be measured |
| `GET/POST /api/patient/assessments`, `GET/PUT /api/patient/assessments/{id}`, `POST .../submit`, `GET .../history` | patient | own assessments |
| `GET/POST /api/patient/performances`, `GET /api/patient/rehab-progress` | patient | log performance, comparison |
| `GET /api/patient/videos`, `GET/POST /api/patient/video-submissions`, `PUT .../{id}` | patient | resources, suggestions, resubmission |
| `GET/POST /api/therapist/library/exercises`, `PUT .../{id}`, `PUT .../{id}/archive`, `PUT .../{id}/restore` | therapist / admin | exercise library |
| `POST /api/therapist/assignments/{id}/approve` | assigned therapist | clinical approval of a prescription |
| `GET /api/therapist/assessments/pending`, `GET/POST /api/therapist/patients/{id}/assessments` | therapist | review queue; record an assessment |
| `GET /api/therapist/assessments/{id}`, `GET .../history`, `POST .../corrections`, `POST .../approve`, `POST .../request-revision` | therapist (decisions: assigned therapist) | review |
| `GET/POST /api/therapist/patients/{id}/performances`, `PUT /api/therapist/performances/{id}/feedback`, `GET /api/therapist/patients/{id}/rehab-progress` | therapist | performance and comparison |
| `GET /api/therapist/videos/submissions[?status=]`, `GET .../{id}`, `POST .../{id}/approve`, `/reject`, `/request-revision`, `GET /api/therapist/videos/history` | therapist | video review |
| `GET/POST /api/therapist/videos/library`, `PUT/DELETE .../{id}`, `GET/POST /api/therapist/patients/{id}/video-resources`, `DELETE /api/therapist/video-resources/{id}` | therapist | library videos and patient resources |
| `GET /api/notifications`, `GET .../unread-count`, `PUT .../{id}/read`, `PUT .../read-all` | any | own notifications |

## Screens

* **Admin** (lands on `/dashboard` = administration): statistics, therapist workload, recent
  activity; `/admin/users` (create, role, activate/deactivate, role/permission matrix);
  `/admin/assignments` (assign/reassign with reason); `/admin/activity` (audit log). Admins can
  still open every patient (read-only for clinical decisions).
* **Therapist**: dashboard with "Waiting for your review"; patient profile tabs Overview,
  Assessments, Exercise program (targets beside the baseline, approval with readiness
  confirmation), Progress & targets (comparison, charts, performance log, feedback, therapist
  measurements), Camera sessions, Videos, Reports (now include the comparison, also in the PDF);
  `/therapist/assessments/:id` review; `/therapist/videos` (new/pending, approved, rejected,
  revision, history, library); `/therapist/library` (exercise library with parameters).
* **Patient**: dashboard assessment card and program cards with explicit status (start / log
  only when approved); `/assessment`; `/program/:id/log`; Progress (baseline vs target vs latest,
  recorded performance with feedback, camera sessions, shared reports); `/videos`;
  `/notifications`.
