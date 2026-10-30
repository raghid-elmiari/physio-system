import { useState } from "react";
import { errorMessage, fieldErrors } from "../../api/client";
import { exercisesApi, therapistApi } from "../../api/services";
import { useApi } from "../../lib/useApi";
import { formatCalendarDate, formatDateTime, toIsoDate } from "../../lib/format";
import {
  DIFFICULTY_LABELS,
  PRESCRIPTION_STATUS_LABELS,
  PRESCRIPTION_STATUS_TONES,
  describeDose,
} from "../../lib/clinicalLabels";
import { EmptyState, ErrorState, Field, Spinner } from "../../components/ui";

const CURRENT_STATUSES = ["ACTIVE", "PAUSED"];

/** The patient's exercise program: prescribe from the library, edit, pause, resume, end, and the full history. */
export default function PrescriptionPanel({ patientId, onProgramChanged }) {
  const prescriptions = useApi(() => therapistApi.assignments(patientId, { includeHistory: true }), [patientId]);
  const exercises = useApi(() => exercisesApi.list(), []);
  const [editor, setEditor] = useState(null); // null | { mode: "new", exerciseId? } | { mode: "edit", prescription }
  const [actionError, setActionError] = useState(null);

  const all = prescriptions.data || [];
  const current = all.filter((p) => CURRENT_STATUSES.includes(p.status));
  const history = all.filter((p) => !CURRENT_STATUSES.includes(p.status));

  function refresh() {
    prescriptions.reload();
    onProgramChanged?.();
  }

  async function handleStatusChange(prescription, status, question) {
    if (question && !window.confirm(question)) return;
    setActionError(null);
    try {
      await therapistApi.setPrescriptionStatus(prescription.id, status);
      refresh();
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  return (
    <div className="stack">
      {editor && (
        <PrescriptionForm
          key={editor.mode === "edit" ? `edit-${editor.prescription.id}` : `new-${editor.exerciseId ?? ""}`}
          patientId={patientId}
          exercises={exercises.data || []}
          editor={editor}
          onCancel={() => setEditor(null)}
          onSaved={() => { setEditor(null); refresh(); }}
        />
      )}

      <section className="card">
        <div className="card-head">
          <h2>Current program</h2>
          {!editor && <button type="button" className="btn sm" onClick={() => setEditor({ mode: "new" })}>Prescribe exercise</button>}
        </div>
        {actionError && <div className="alert error" style={{ marginBottom: 12 }}>{actionError}</div>}
        {prescriptions.loading && <Spinner />}
        {prescriptions.error && <ErrorState message={prescriptions.error} onRetry={prescriptions.reload} />}
        {prescriptions.data && current.length === 0 && (
          <EmptyState icon="🗒" title="No exercises prescribed">Choose an exercise from the library below to start the program.</EmptyState>
        )}
        <ul className="list">
          {current.map((p) => (
            <li key={p.id} className="list-item prescription">
              <div className="main">
                <div className="title">
                  {p.exercise.name}{" "}
                  <span className={`badge ${PRESCRIPTION_STATUS_TONES[p.status]}`}>{PRESCRIPTION_STATUS_LABELS[p.status]}</span>{" "}
                  {p.difficulty && <span className="badge">{DIFFICULTY_LABELS[p.difficulty]}</span>}
                </div>
                <div className="sub">{describeDose(p)}</div>
                <div className="sub">
                  {p.startDate ? `From ${formatCalendarDate(p.startDate)}` : "No start date"}
                  {p.endDate ? ` to ${formatCalendarDate(p.endDate)}` : ", no end date"}
                  {p.sessionsPerWeek ? ` · ${p.completedSessionsLast7Days} of ${p.sessionsPerWeek} done in the last 7 days` : ""}
                </div>
                {p.notes && <div className="sub">Instructions: “{p.notes}”</div>}
              </div>
              <div className="actions">
                <button type="button" className="btn secondary sm" onClick={() => setEditor({ mode: "edit", prescription: p })}>Edit</button>
                {p.status === "ACTIVE"
                  ? <button type="button" className="btn ghost sm" onClick={() => handleStatusChange(p, "PAUSED")}>Pause</button>
                  : <button type="button" className="btn ghost sm" onClick={() => handleStatusChange(p, "ACTIVE")}>Resume</button>}
                <button type="button" className="btn ghost sm" onClick={() => handleStatusChange(p, "COMPLETED", `Mark ${p.exercise.name} as completed? It leaves the patient's program.`)}>Complete</button>
                <button type="button" className="btn ghost sm danger-text" onClick={() => handleStatusChange(p, "DISCONTINUED", `Discontinue ${p.exercise.name}? It leaves the patient's program; the history is kept.`)}>Discontinue</button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>Exercise library</h2>
        {exercises.loading && <Spinner />}
        {exercises.error && <ErrorState message={exercises.error} onRetry={exercises.reload} />}
        <ul className="list">
          {(exercises.data || []).map((exercise) => (
            <li key={exercise.id} className="list-item">
              <div className="main">
                <div className="title">
                  {exercise.name}{" "}
                  {exercise.cameraMonitoringSupported ? <span className="badge primary">Camera coach</span> : <span className="badge">No camera analysis</span>}
                </div>
                <div className="sub">{[exercise.bodyRegion, `${exercise.defaultReps} reps default`, exercise.description].filter(Boolean).join(" · ")}</div>
              </div>
              <button
                type="button"
                className="btn secondary sm"
                onClick={() => { setEditor({ mode: "new", exerciseId: exercise.id }); window.scrollTo({ top: 0, behavior: "smooth" }); }}
              >
                Prescribe
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>Prescription history</h2>
        {prescriptions.data && history.length === 0 && <p className="muted">No earlier prescriptions.</p>}
        {history.length > 0 && (
          <div className="table-wrap">
            <table className="table responsive">
              <thead>
                <tr><th>Exercise</th><th>Dose</th><th>Period</th><th>Status</th><th>Prescribed</th></tr>
              </thead>
              <tbody>
                {history.map((p) => (
                  <tr key={p.id}>
                    <td className="primary">{p.exercise.name}</td>
                    <td data-label="Dose">{describeDose(p)}{p.difficulty ? ` · ${DIFFICULTY_LABELS[p.difficulty]}` : ""}</td>
                    <td data-label="Period">{p.startDate ? formatCalendarDate(p.startDate) : "—"} – {p.endDate ? formatCalendarDate(p.endDate) : "open"}</td>
                    <td data-label="Status"><span className={`badge ${PRESCRIPTION_STATUS_TONES[p.status]}`}>{PRESCRIPTION_STATUS_LABELS[p.status]}</span></td>
                    <td data-label="Prescribed">{formatDateTime(p.createdAt)}{p.assignedBy ? ` by ${p.assignedBy}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function initialForm(editor, exercises) {
  if (editor.mode === "edit") {
    const p = editor.prescription;
    return {
      exerciseId: String(p.exercise.id),
      targetReps: p.targetReps,
      setsPerSession: p.setsPerSession,
      sessionsPerWeek: p.sessionsPerWeek ?? "",
      durationSeconds: p.durationSeconds ?? "",
      restSeconds: p.restSeconds ?? "",
      startDate: p.startDate ?? "",
      endDate: p.endDate ?? "",
      difficulty: p.difficulty ?? "",
      notes: p.notes ?? "",
    };
  }
  const exercise = exercises.find((e) => e.id === editor.exerciseId);
  return {
    exerciseId: editor.exerciseId ? String(editor.exerciseId) : "",
    targetReps: exercise?.defaultReps ?? 10,
    setsPerSession: 1,
    sessionsPerWeek: 5,
    durationSeconds: "",
    restSeconds: 30,
    startDate: toIsoDate(new Date()),
    endDate: "",
    difficulty: "MODERATE",
    notes: "",
  };
}

function validatePrescription(form) {
  const errors = {};
  const inRange = (value, min, max) => value === "" || (Number.isInteger(value) && value >= min && value <= max);
  if (!form.exerciseId) errors.exerciseId = "Choose an exercise";
  if (!(Number.isInteger(form.targetReps) && form.targetReps >= 1 && form.targetReps <= 100)) errors.targetReps = "1–100 repetitions";
  if (!(Number.isInteger(form.setsPerSession) && form.setsPerSession >= 1 && form.setsPerSession <= 10)) errors.setsPerSession = "1–10 sets";
  if (!inRange(form.sessionsPerWeek, 1, 21)) errors.sessionsPerWeek = "1–21 per week";
  if (!inRange(form.durationSeconds, 0, 3600)) errors.durationSeconds = "0–3600 seconds";
  if (!inRange(form.restSeconds, 0, 3600)) errors.restSeconds = "0–3600 seconds";
  if (form.startDate && form.endDate && form.endDate < form.startDate) errors.endDate = "End date is before the start date";
  return errors;
}

function PrescriptionForm({ patientId, exercises, editor, onCancel, onSaved }) {
  const [form, setForm] = useState(() => initialForm(editor, exercises));
  const [state, setState] = useState({ busy: false, error: null, fields: {} });
  const editing = editor.mode === "edit";
  const selectedExercise = exercises.find((e) => String(e.id) === form.exerciseId);

  const setText = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  const setNumber = (key) => (e) => setForm({ ...form, [key]: e.target.value === "" ? "" : Number(e.target.value) });

  async function handleSavePrescription(e) {
    e.preventDefault();
    const fields = validatePrescription(form);
    if (Object.keys(fields).length) return setState({ busy: false, error: null, fields });
    setState({ busy: true, error: null, fields: {} });
    const orNull = (value) => (value === "" ? null : value);
    const body = {
      exerciseId: Number(form.exerciseId),
      targetReps: form.targetReps,
      setsPerSession: form.setsPerSession,
      sessionsPerWeek: orNull(form.sessionsPerWeek),
      durationSeconds: orNull(form.durationSeconds),
      restSeconds: orNull(form.restSeconds),
      startDate: orNull(form.startDate),
      endDate: orNull(form.endDate),
      difficulty: orNull(form.difficulty),
      notes: form.notes.trim() || null,
    };
    try {
      if (editing) await therapistApi.revisePrescription(editor.prescription.id, body);
      else await therapistApi.assign(patientId, body);
      onSaved();
    } catch (err) {
      setState({ busy: false, error: errorMessage(err), fields: fieldErrors(err) });
    }
  }

  return (
    <form className="card" onSubmit={handleSavePrescription} noValidate>
      <h2>{editing ? `Edit prescription: ${editor.prescription.exercise.name}` : "Prescribe an exercise"}</h2>
      {editing && <p className="small muted">Saving creates a new version of this prescription; the current one is kept in the history.</p>}
      <Field label="Exercise" htmlFor="rx-exercise" error={state.fields.exerciseId}>
        <select id="rx-exercise" className="input" value={form.exerciseId} disabled={editing} onChange={setText("exerciseId")}>
          <option value="">Choose from the library…</option>
          {exercises.map((x) => <option key={x.id} value={x.id}>{x.name}{x.cameraMonitoringSupported ? "" : " (no camera analysis)"}</option>)}
        </select>
      </Field>
      {selectedExercise?.description && <p className="small muted">{selectedExercise.description}</p>}

      <div className="grid cols-3" style={{ gap: 0, columnGap: 12 }}>
        <Field label="Repetitions" htmlFor="rx-reps" error={state.fields.targetReps}><input id="rx-reps" type="number" min="1" max="100" className="input" value={form.targetReps} onChange={setNumber("targetReps")} /></Field>
        <Field label="Sets" htmlFor="rx-sets" error={state.fields.setsPerSession}><input id="rx-sets" type="number" min="1" max="10" className="input" value={form.setsPerSession} onChange={setNumber("setsPerSession")} /></Field>
        <Field label="Sessions per week" htmlFor="rx-week" error={state.fields.sessionsPerWeek}><input id="rx-week" type="number" min="1" max="21" className="input" value={form.sessionsPerWeek} onChange={setNumber("sessionsPerWeek")} /></Field>
        <Field label="Duration / hold (s)" htmlFor="rx-duration" error={state.fields.durationSeconds} help="Optional"><input id="rx-duration" type="number" min="0" max="3600" className="input" value={form.durationSeconds} onChange={setNumber("durationSeconds")} /></Field>
        <Field label="Rest between sets (s)" htmlFor="rx-rest" error={state.fields.restSeconds}><input id="rx-rest" type="number" min="0" max="3600" className="input" value={form.restSeconds} onChange={setNumber("restSeconds")} /></Field>
        <Field label="Difficulty" htmlFor="rx-difficulty" error={state.fields.difficulty}>
          <select id="rx-difficulty" className="input" value={form.difficulty} onChange={setText("difficulty")}>
            <option value="">Not set</option>
            {Object.entries(DIFFICULTY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
        <Field label="Start date" htmlFor="rx-start" error={state.fields.startDate}><input id="rx-start" type="date" className="input" value={form.startDate} onChange={setText("startDate")} /></Field>
        <Field label="End date" htmlFor="rx-end" error={state.fields.endDate} help="Optional"><input id="rx-end" type="date" className="input" value={form.endDate} onChange={setText("endDate")} /></Field>
      </div>
      <Field label="Instructions for the patient" htmlFor="rx-notes" error={state.fields.notes} help="Shown on the patient's dashboard.">
        <textarea id="rx-notes" className="input" rows={2} maxLength={500} value={form.notes} onChange={setText("notes")} />
      </Field>
      {state.error && <div className="alert error" style={{ marginBottom: 12 }}>{state.error}</div>}
      <div className="row">
        <button type="submit" className="btn" disabled={state.busy}>{state.busy ? "Saving…" : editing ? "Save new version" : "Save prescription"}</button>
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
