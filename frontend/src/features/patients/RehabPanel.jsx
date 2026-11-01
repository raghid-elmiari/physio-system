import { useState } from "react";
import { errorMessage } from "../../api/client";
import { therapistApi } from "../../api/services";
import { useApi } from "../../lib/useApi";
import { lastDaysRange } from "../../lib/format";
import { ErrorState, Field, Spinner } from "../../components/ui";
import { MeasurementFields, PerformanceList, RehabProgressView } from "../../components/clinical";
import { measurementPayload, splitRepetitionParameter, validateMeasurements, withRepetitions } from "../../lib/measurements";
import DateRangePicker from "./DateRangePicker";

/** Baseline vs target vs actual, the performance log with feedback, and therapist measurements. */
export default function RehabPanel({ patientId }) {
  const [range, setRange] = useState(() => lastDaysRange(90));
  const progress = useApi(() => therapistApi.rehabProgress(patientId, range.from, range.to), [patientId, range.from, range.to]);
  const entries = useApi(() => therapistApi.performances(patientId), [patientId]);
  const program = useApi(() => therapistApi.assignments(patientId), [patientId]);
  const [recording, setRecording] = useState(false);
  const refresh = () => { progress.reload(); entries.reload(); };

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head">
          <h2>Progress against targets</h2>
          <DateRangePicker value={range} onChange={setRange} />
        </div>
        {progress.loading && <Spinner />}
        {progress.error && <ErrorState message={progress.error} onRetry={progress.reload} />}
      </section>
      {progress.data && <RehabProgressView data={progress.data} />}
      {recording && (
        <RecordPerformance patientId={patientId} prescriptions={(program.data || []).filter((p) => p.approvedAt)}
          onCancel={() => setRecording(false)} onSaved={() => { setRecording(false); refresh(); }} />
      )}
      <section className="card">
        <div className="card-head">
          <h2>Performance log</h2>
          {!recording && <button type="button" className="btn secondary sm" onClick={() => setRecording(true)}>Record measurement</button>}
        </div>
        {entries.loading && <Spinner />}
        {entries.error && <ErrorState message={entries.error} onRetry={entries.reload} />}
        {entries.data && <PerformanceList entries={entries.data} renderActions={(e) => <FeedbackForm entry={e} onSaved={entries.reload} />} />}
      </section>
    </div>
  );
}

function FeedbackForm({ entry, onSaved }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(entry.therapistFeedback ?? "");
  const [state, setState] = useState({ busy: false, error: null });
  if (!open) return <button type="button" className="btn ghost sm" style={{ marginTop: 6 }} onClick={() => setOpen(true)}>{entry.therapistFeedback ? "Edit feedback" : "Give feedback"}</button>;
  async function save() {
    if (!text.trim()) return setState({ busy: false, error: "Write some feedback first." });
    setState({ busy: true, error: null });
    try {
      await therapistApi.performanceFeedback(entry.id, text.trim());
      setOpen(false);
      setState({ busy: false, error: null });
      onSaved();
    } catch (err) {
      setState({ busy: false, error: errorMessage(err) });
    }
  }
  return (
    <div className="confirm-box" style={{ marginTop: 8 }}>
      <label className="sr-only" htmlFor={`fb-${entry.id}`}>Feedback</label>
      <textarea id={`fb-${entry.id}`} className="input" rows={2} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Feedback the patient will see" />
      {state.error && <div className="alert error small" style={{ marginTop: 6 }}>{state.error}</div>}
      <div className="row" style={{ marginTop: 6 }}>
        <button type="button" className="btn sm" disabled={state.busy} onClick={save}>{state.busy ? "Sending…" : "Send feedback"}</button>
        <button type="button" className="btn ghost sm" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}

function RecordPerformance({ patientId, prescriptions, onCancel, onSaved }) {
  const [rxId, setRxId] = useState(prescriptions[0]?.id ? String(prescriptions[0].id) : "");
  const rx = prescriptions.find((p) => String(p.id) === rxId);
  const { repsParameter, otherParameters: params } = splitRepetitionParameter((rx?.exercise.parameters || []).filter((p) => p.active));
  const [values, setValues] = useState({});
  const [form, setForm] = useState({ repsCompleted: "", setsCompleted: "", painLevel: "", notes: "" });
  const [state, setState] = useState({ busy: false, error: null, measure: {} });
  const num = (k) => (e) => setForm({ ...form, [k]: e.target.value === "" ? "" : Number(e.target.value) });

  async function save() {
    const measure = validateMeasurements(params, values);
    if (Object.keys(measure).length) return setState({ busy: false, error: "Check the highlighted measurements.", measure });
    setState({ busy: true, error: null, measure: {} });
    const orNull = (v) => (v === "" ? null : v);
    try {
      await therapistApi.recordPerformance(patientId, {
        assignmentId: Number(rxId), repsCompleted: orNull(form.repsCompleted), setsCompleted: orNull(form.setsCompleted),
        painLevel: orNull(form.painLevel), notes: form.notes.trim() || null,
        measurements: withRepetitions(measurementPayload(params, values), repsParameter, orNull(form.repsCompleted)),
      });
      onSaved();
    } catch (err) {
      setState({ busy: false, error: errorMessage(err), measure: {} });
    }
  }

  if (prescriptions.length === 0) {
    return <div className="alert info">Approve a prescription first; measurements are recorded against an approved prescription. <button type="button" className="btn ghost sm" onClick={onCancel}>Close</button></div>;
  }
  return (
    <section className="card">
      <h2>Record a therapist measurement</h2>
      <Field label="Prescription" htmlFor="rp-rx">
        <select id="rp-rx" className="input" value={rxId} onChange={(e) => { setRxId(e.target.value); setValues({}); }}>
          {prescriptions.map((p) => <option key={p.id} value={p.id}>{p.exercise.name}</option>)}
        </select>
      </Field>
      <div className="grid cols-3" style={{ gap: 0, columnGap: 12 }}>
        <Field label="Repetitions" htmlFor="rp-reps"><input id="rp-reps" type="number" min="0" className="input" value={form.repsCompleted} onChange={num("repsCompleted")} /></Field>
        <Field label="Sets" htmlFor="rp-sets"><input id="rp-sets" type="number" min="0" className="input" value={form.setsCompleted} onChange={num("setsCompleted")} /></Field>
        <Field label="Pain (0–10)" htmlFor="rp-pain"><input id="rp-pain" type="number" min="0" max="10" className="input" value={form.painLevel} onChange={num("painLevel")} /></Field>
      </div>
      <MeasurementFields parameters={params} values={values} onChange={setValues} errors={state.measure} idPrefix="rp" />
      <Field label="Notes" htmlFor="rp-notes"><input id="rp-notes" className="input" maxLength={1000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
      {state.error && <div className="alert error" style={{ marginBottom: 12 }}>{state.error}</div>}
      <div className="row">
        <button type="button" className="btn" disabled={state.busy} onClick={save}>{state.busy ? "Saving…" : "Save measurement"}</button>
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </section>
  );
}
