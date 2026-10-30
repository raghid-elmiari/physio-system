# Physiotherapist dashboard

Physiotherapists (role `THERAPIST`) and administrators (`ADMIN`) land on the dashboard after
signing in. Patients keep their existing exercise dashboard, live camera sessions and
voice coach, which are unchanged.

## Access rules

| | Physiotherapist | Admin | Patient |
|---|---|---|---|
| Dashboard, patient list | own linked patients | all patients | no (403) |
| Patient profile, prescriptions, notes, performance, reports | own linked patients | all patients | no (403) |
| Own program, sessions, progress | n/a | n/a | yes |
| Reports | write | write | read, only once shared, only their own |

* Enforced in the API (`SecurityConfig` for roles, `PatientAccessPolicy` for "which patient").
  A patient the caller may not see answers **404**, so other patients' existence isn't revealed.
* The role and account status are read from the database on every request
  (`JwtAuthFilter`), not trusted from the token. Deactivating a patient or changing a role
  takes effect immediately.
* The frontend hides staff pages from patients, but that is only for usability.

## Screens

**Dashboard** (`/dashboard` for staff): registered / active / needing-attention patients,
prescriptions in force, completed and interrupted sessions (30 days), completed and still
pending sessions this week, average accuracy, the patients requiring attention with the
reason, recent activity, and weekly charts of sessions and accuracy.

A patient *requires attention* when they have a prescription in force and
(a) no completed session in 7 days, (b) average accuracy under 60% over their last 3
sessions, or (c) 2+ sessions stopped early in the last 7 days.

**Patients** (`/patients`): search by name, email or ID; filter by rehabilitation status
(Assessment, In treatment, On hold, Discharged) and account status; create a new patient
account (temporary password) or link a patient who registered themselves.

**Patient profile** (`/patients/:id`), four tabs:

* *Overview*: details (phone, date of birth, condition, rehab status), activate/deactivate,
  recent sessions, private clinical notes.
* *Exercise program*: exercise library, prescribe (reps, sets, sessions per week,
  duration/hold, rest, start/end date, difficulty, instructions), edit, pause/resume,
  complete, discontinue, and the full prescription history.
* *Performance*: any date range; completed / interrupted / estimated missed sessions,
  repetitions, accuracy per session, per-exercise errors and joint-angle averages,
  automated flags and the session log (each session links to its detailed report).
* *Reports*: generate a report for a date range and open previous ones.

**Report** (`/therapist/reports/:id`): patient information, prescriptions, system-generated
performance and progress, the physiotherapist's assessment (observations,
recommendations, exercise modifications, follow-up), **Download PDF**, **Print**, and
**Share with patient**. Patients find shared reports under Progress.

## Prescription workflow

1. The physiotherapist prescribes an exercise from the library.
2. It is stored in `exercise_assignments` and appears on the patient's dashboard at once
   (dose, dates, difficulty and instructions shown on the exercise card).
3. The patient starts a session from the card; the session is linked to the prescription.
4. **Editing creates a new version.** The old row becomes `REPLACED` and the new one points
   to it (`previous_assignment_id`). Sessions stay linked to the dose that was actually
   prescribed at the time, and nothing is overwritten.
5. Pausing hides it from the patient's program until resumed; completing or discontinuing
   ends it. History is never deleted.

## What the measurements are (and aren't)

Everything comes from what the on-device MediaPipe coach already records per session:
repetitions counted, repetitions without a persistent movement error ("correct"),
duration, the movement errors it flagged (with counts), and the analyzer's angle metrics
(e.g. average top arm angle, time fully visible to the camera).

* **Accuracy** = correct repetitions ÷ counted repetitions (unchanged from before).
* **Sets are not tracked** by the camera analysis, so reports show the prescribed sets but no
  "completed sets" figure.
* **Expected/missed sessions** are an estimate: weekly frequency × days the prescription
  was active.
* **Automated findings** are simple rules (accuracy up ≥ 10 points, average under 60%,
  an error flagged ≥ 5 times, under 50% of prescribed sessions done). They are labelled
  "System-generated" and kept visually and structurally apart from the
  physiotherapist's assessment.

Reports freeze these measurements when generated (`patient_reports.measurements_json`),
so a report reads the same later. Only the assessment text and sharing flag can change.

## PDF

`Download PDF` builds a real PDF file in the browser (`src/lib/pdf/PdfDocument.js`, no
library). It uses the standard PDF Helvetica font, which covers Western European
characters only; names in other scripts (e.g. Arabic) appear as "?". **Print** (or the
browser's *Save as PDF*) uses a print stylesheet and supports every script.
