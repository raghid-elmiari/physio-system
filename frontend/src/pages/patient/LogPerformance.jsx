import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { errorMessage, fieldErrors } from "../../api/client";
import { exercisesApi, patientApi } from "../../api/services";
import { useApi } from "../../lib/useApi";
import { describeDose, formatMeasured } from "../../lib/clinicalLabels";
import { ErrorState, Field, Spinner } from "../../components/ui";
import { MeasurementFields } from "../../components/clinical";
import { measurementPayload, splitRepetitionParameter, validateMeasurements, withRepetitions } from "../../lib/measurements";

/** Patient records how an approved exercise went. Targets are shown for reference only. */
export default function LogPerformance() {
  const { assignmentId } = useParams();
  const program = useApi(() => exercisesApi.myAssignments(), []);
  const rx = (program.data || []).find((a) => String(a.id) === String(assignmentId));

  if (program.loading) return <main className="page"><Spinner /></main>;
  if (program.error) return <main className="page"><ErrorState message={program.error} onRetry={program.reload} /></main>;
  if (!rx) return <main className="page"><ErrorState message="This exercise is not in your program." /></main>;
  return <LogForm rx={rx} />;
}

function LogForm({ rx }) {
  const navigate = useNavigate();
  const { repsParameter, otherParameters: params } = splitRepetitionParameter((rx.exercise.parameters || []).filter((p) => p.active));
  // Start empty: pre-filling the prescribed dose would nudge patients to report the target.
  const [form, setForm] = useState({ repsCompleted: "", setsCompleted: "", durationSeconds: "", painLevel: "", difficultyRating: "", notes: "" });
  const [values, setValues] = useState({});
  const [state, setState] = useState({ busy: false, error: null, fields: {}, measure: {} });
  const setNum = (k) => (e) => setForm({ ...form, [k]: e.target.value === "" ? "" : Number(e.target.value) });

  async function submit(e) {
    e.preventDefault();
    const measure = validateMeasurements(params, values);
    if (Object.keys(measure).length) return setState({ busy: false, error: "Check the highlighted measurements.", fields: {}, measure });
    setState({ busy: true, error: null, fields: {}, measure: {} });
    const orNull = (v) => (v === "" ? null : v);
    try {
      await patientApi.logPerformance({
        assignmentId: rx.id,
        repsCompleted: orNull(form.repsCompleted),
        setsCompleted: orNull(form.setsCompleted),
        durationSeconds: orNull(form.durationSeconds),
        painLevel: orNull(form.painLevel),
        difficultyRating: orNull(form.difficultyRating),
        notes: form.notes.trim() || null,
        measurements: withRepetitions(measurementPayload(params, values), repsParameter, orNull(form.repsCompleted)),
      });
      navigate("/progress", { state: { logged: rx.exercise.name } });
    } catch (err) {
      setState({ busy: false, error: errorMessage(err), fields: fieldErrors(err), measure: {} });
    }
  }

  if (!rx.startable) {
    return (
      <main className="page narrow">
        <p><Link to="/dashboard">← Home</Link></p>
        <div className="alert warning">{rx.startBlockedReason}</div>
      </main>
    );
  }

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p><Link to="/dashboard">← Home</Link></p>
          <h1>Log: {rx.exercise.name}</h1>
          <p>Prescribed: {describeDose(rx)}</p>
        </div>
      </div>
      <form className="stack" onSubmit={submit} noValidate>
        {rx.safetyInstructions && <div className="alert warning"><strong>Safety:</strong> {rx.safetyInstructions}</div>}
        {rx.targets?.length > 0 && (
          <section className="card">
            <h2>Your physiotherapist&apos;s targets</h2>
            <ul className="list">{rx.targets.map((t) => <li key={t.id} className="list-item"><div className="main">{t.label}</div><strong>{formatMeasured(t, t.unit)}</strong></li>)}</ul>
            <p className="small muted">Targets are set by your physiotherapist and only they can change them.</p>
          </section>
        )}
        <section className="card">
          <h2>What you did</h2>
          <div className="grid cols-3" style={{ gap: 0, columnGap: 12 }}>
            <Field label="Repetitions" htmlFor="lp-reps" error={state.fields.repsCompleted} help={`Prescribed: ${rx.targetReps}`}><input id="lp-reps" type="number" min="0" max="1000" className="input" value={form.repsCompleted} onChange={setNum("repsCompleted")} /></Field>
            <Field label="Sets" htmlFor="lp-sets" error={state.fields.setsCompleted} help={`Prescribed: ${rx.setsPerSession}`}><input id="lp-sets" type="number" min="0" max="50" className="input" value={form.setsCompleted} onChange={setNum("setsCompleted")} /></Field>
            <Field label="Duration (seconds)" htmlFor="lp-dur" error={state.fields.durationSeconds} help="Optional"><input id="lp-dur" type="number" min="0" max="86400" className="input" value={form.durationSeconds} onChange={setNum("durationSeconds")} /></Field>
            <Field label="Pain or discomfort (0–10)" htmlFor="lp-pain" error={state.fields.painLevel}>
              <select id="lp-pain" className="input" value={form.painLevel} onChange={setNum("painLevel")}>
                <option value="">Not rated</option>
                {Array.from({ length: 11 }, (_, n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </Field>
            <Field label="How hard was it? (1–5)" htmlFor="lp-diff" error={state.fields.difficultyRating}>
              <select id="lp-diff" className="input" value={form.difficultyRating} onChange={setNum("difficultyRating")}>
                <option value="">Not rated</option>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </Field>
          </div>
          {form.painLevel !== "" && form.painLevel >= 7 && (
            <div className="alert warning small" style={{ marginBottom: 12 }}>High pain will be flagged to your physiotherapist. Stop the exercise if the pain is sharp or getting worse.</div>
          )}
        </section>
        {params.length > 0 && (
          <section className="card">
            <h2>Measurements</h2>
            <MeasurementFields parameters={params} values={values} onChange={setValues} errors={state.measure} idPrefix="lp" />
          </section>
        )}
        <Field label="Notes" htmlFor="lp-notes"><textarea id="lp-notes" className="input" rows={2} maxLength={1000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        {state.error && <div className="alert error">{state.error}</div>}
        <div className="row">
          <button type="submit" className="btn" disabled={state.busy}>{state.busy ? "Saving…" : "Save entry"}</button>
          <Link className="btn ghost" to="/dashboard">Cancel</Link>
        </div>
      </form>
    </main>
  );
}
