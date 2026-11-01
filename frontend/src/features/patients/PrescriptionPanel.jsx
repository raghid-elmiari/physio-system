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
import { formatMeasured } from "../../lib/clinicalLabels";
import { MeasurementFields } from "../../components/clinical";
import { measurementPayload, validateMeasurements } from "../../lib/measurements";

/** parameterId → baseline measurement of the patient's approved baseline assessment. */
async function baselineValues(patientId) {
  const list = await therapistApi.patientAssessments(patientId);
  const base = list.find((a) => a.isBaseline);
  if (!base) return {};
  const full = await therapistApi.assessment(base.id);
  const out = {};
  for (const item of full.items) for (const m of item.measurements) if (!m.superseded) out[m.parameterId] = m;
  return out;
}

/** The treating therapist confirms readiness before the prescription goes into force. */
function ApproveBox({ prescription, onCancel, onDone }) {
  const [ready, setReady] = useState(false);
  const [note, setNote] = useState("");
  const [state, setState] = useState({ busy: false, error: null });
  async function approve() {
    setState({ busy: true, error: null });
    try {
      await therapistApi.approvePrescription(prescription.id, { readinessConfirmed: ready, note: note.trim() || null });
      onDone();
    } catch (err) {
      setState({ busy: false, error: errorMessage(err) });
    }
  }
  return (
    <div className="confirm-box" style={{ marginTop: 10 }}>
      <label className="switch"><input type="checkbox" checked={ready} onChange={(e) => setReady(e.target.checked)} /> I have assessed this patient and they are clinically ready for {prescription.exercise.name} at this dose.</label>
      <Field label="Approval note (optional)" htmlFor={`appr-${prescription.id}`}>
        <input id={`appr-${prescription.id}`} className="input" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {state.error && <div className="alert error small" style={{ marginBottom: 8 }}>{state.error}</div>}
      <div className="row">
        <button type="button" className="btn sm" disabled={!ready || state.busy} onClick={approve}>{state.busy ? "Approving…" : "Approve prescription"}</button>
        <button type="button" className="btn ghost sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

const CURRENT_STATUSES = ["PENDING_APPROVAL", "APPROVED", "ACTIVE", "PAUSED"];

/** The patient's exercise program: prescribe from the library, edit, pause, resume, end, and the full history. */
export default function PrescriptionPanel({ patientId, onProgramChanged, canDecide = true }) {
  const prescriptions = useApi(() => therapistApi.assignments(patientId, { includeHistory: true }), [patientId]);
  const exercises = useApi(() => exercisesApi.list(), []);
  // Baseline values per parameter, shown beside the targets being set.
  const baseline = useApi(() => baselineValues(patientId), [patientId]);
  const [editor, setEditor] = useState(null); // null | { mode: "new", exerciseId? } | { mode: "edit", prescription }
  const [approving, setApproving] = useState(null);
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
          baseline={baseline.data || {}}
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
        {!canDecide && <div className="alert info small" style={{ marginBottom: 12 }}>Only the patient&apos;s assigned physiotherapist can approve or resume prescriptions.</div>}
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
                {p.safetyInstructions && <div className="sub warning-text">Safety: {p.safetyInstructions}</div>}
                {p.targets?.length > 0 && (
                  <div className="sub">Targets: {p.targets.map((t) => `${t.label} ${formatMeasured(t, t.unit)}${baseline.data?.[t.parameterId] ? ` (baseline ${formatMeasured(baseline.data[t.parameterId], t.unit)})` : ""}`).join(" · ")}</div>
                )}
                {p.approvedAt
                  ? <div className="sub">Approved {formatDateTime(p.approvedAt)}{p.approvedBy ? ` by ${p.approvedBy}` : ""}{p.approvalNote ? ` – “${p.approvalNote}”` : ""}</div>
                  : <div className="sub warning-text">Not approved: the patient cannot start this exercise yet.</div>}
                {approving === p.id && (
                  <ApproveBox prescription={p} onCancel={() => setApproving(null)} onDone={() => { setApproving(null); refresh(); }} />
                )}
              </div>
              <div className="actions">
                {p.status === "PENDING_APPROVAL" && canDecide && approving !== p.id && (
                  <button type="button" className="btn sm" onClick={() => setApproving(p.id)}>Approve</button>
                )}
                <button type="button" className="btn secondary sm" onClick={() => setEditor({ mode: "edit", prescription: p })}>Edit</button>
                {(p.status === "ACTIVE" || p.status === "APPROVED") && <button type="button" className="btn ghost sm" onClick={() => handleStatusChange(p, "PAUSED")}>Pause</button>}
                {p.status === "PAUSED" && canDecide && <button type="button" className="btn ghost sm" onClick={() => handleStatusChange(p, "ACTIVE")}>Resume</button>}
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
      instructions: p.instructions ?? "",
      safetyInstructions: p.safetyInstructions ?? "",
      expectedProgression: p.expectedProgression ?? "",
      changeReason: "",
      targets: Object.fromEntries((p.targets || []).map((t) => [t.parameterId, { value: t.targetValue ?? "", valueMin: t.targetMin ?? "", valueMax: t.targetMax ?? "" }])),
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
    instructions: exercise?.instructions ?? "",
    safetyInstructions: "",
    expectedProgression: "",
    changeReason: "",
    targets: {},
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

function PrescriptionForm({ patientId, exercises, baseline, editor, onCancel, onSaved }) {
  const [form, setForm] = useState(() => initialForm(editor, exercises));
  const [state, setState] = useState({ busy: false, error: null, fields: {}, targets: {} });
  const editing = editor.mode === "edit";
  const selectedExercise = editing ? editor.prescription.exercise : exercises.find((e) => String(e.id) === form.exerciseId);
  const params = (selectedExercise?.parameters || []).filter((p) => p.active);

  const setText = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  const setNumber = (key) => (e) => setForm({ ...form, [key]: e.target.value === "" ? "" : Number(e.target.value) });

  async function handleSavePrescription(e) {
    e.preventDefault();
    const fields = validatePrescription(form);
    const targetErrors = validateMeasurements(params, form.targets);
    if (Object.keys(fields).length || Object.keys(targetErrors).length) return setState({ busy: false, error: null, fields, targets: targetErrors });
    setState({ busy: true, error: null, fields: {}, targets: {} });
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
      instructions: form.instructions.trim() || null,
      safetyInstructions: form.safetyInstructions.trim() || null,
      expectedProgression: form.expectedProgression.trim() || null,
      changeReason: form.changeReason.trim() || null,
      targets: measurementPayload(params, form.targets).map((m) => ({ parameterId: m.parameterId, targetValue: m.value ?? null, targetMin: m.valueMin ?? null, targetMax: m.valueMax ?? null })),
    };
    try {
      if (editing) await therapistApi.revisePrescription(editor.prescription.id, body);
      else await therapistApi.assign(patientId, body);
      onSaved();
    } catch (err) {
      setState({ busy: false, error: errorMessage(err), fields: fieldErrors(err), targets: {} });
    }
  }

  return (
    <form className="card" onSubmit={handleSavePrescription} noValidate>
      <h2>{editing ? `Edit prescription: ${editor.prescription.exercise.name}` : "Prescribe an exercise"}</h2>
      {editing && <p className="small muted">Saving creates a new version of this prescription; the current one is kept in the history.</p>}
      {!editing && <p className="small muted">New prescriptions wait for your approval before the patient can start them.</p>}
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
      {params.length > 0 && (
        <fieldset className="measure-field" style={{ marginBottom: 14 }}>
          <legend>Personal targets</legend>
          <p className="small muted" style={{ margin: 0 }}>Leave a measurement empty for no target. The patient cannot change these, and nothing increases them automatically.</p>
          <MeasurementFields parameters={params} values={form.targets} onChange={(targets) => setForm({ ...form, targets })} errors={state.targets} idPrefix="rx-t" baseline={baseline} />
        </fieldset>
      )}
      <Field label="Short note for the patient" htmlFor="rx-notes" error={state.fields.notes} help="Shown on the patient's dashboard.">
        <textarea id="rx-notes" className="input" rows={2} maxLength={500} value={form.notes} onChange={setText("notes")} />
      </Field>
      <Field label="Exercise instructions" htmlFor="rx-instr" error={state.fields.instructions} help="A copy for this patient; editing the library later does not change it.">
        <textarea id="rx-instr" className="input" rows={3} maxLength={4000} value={form.instructions} onChange={setText("instructions")} />
      </Field>
      <div className="grid cols-2" style={{ gap: 0, columnGap: 12 }}>
        <Field label="Safety instructions" htmlFor="rx-safety" error={state.fields.safetyInstructions}>
          <textarea id="rx-safety" className="input" rows={2} maxLength={1000} value={form.safetyInstructions} onChange={setText("safetyInstructions")} />
        </Field>
        <Field label="Expected progression" htmlFor="rx-prog" error={state.fields.expectedProgression} help="Your plan; it never changes the prescription by itself.">
          <textarea id="rx-prog" className="input" rows={2} maxLength={1000} value={form.expectedProgression} onChange={setText("expectedProgression")} />
        </Field>
      </div>
      {editing && (
        <Field label="Reason for the change" htmlFor="rx-reason" error={state.fields.changeReason}>
          <input id="rx-reason" className="input" maxLength={500} value={form.changeReason} onChange={setText("changeReason")} />
        </Field>
      )}
      {state.error && <div className="alert error" style={{ marginBottom: 12 }}>{state.error}</div>}
      <div className="row">
        <button type="submit" className="btn" disabled={state.busy}>{state.busy ? "Saving…" : editing ? "Save new version" : "Save prescription"}</button>
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
