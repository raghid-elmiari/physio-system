import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { errorMessage } from "../../api/client";
import { therapistApi } from "../../api/services";
import { useAuth } from "../../context/AuthContext";
import { useApi } from "../../lib/useApi";
import { formatDateTime } from "../../lib/format";
import { ASSESSMENT_STATUS_LABELS, ASSESSMENT_STATUS_TONES, ASSESSMENT_TYPE_LABELS } from "../../lib/clinicalLabels";
import { ErrorState, Field, Spinner } from "../../components/ui";
import { MeasurementFields } from "../../components/clinical";
import { measurementPayload, validateMeasurements } from "../../lib/measurements";
import { AssessmentReadOnly } from "../../features/assessment/AssessmentForm";

/** Review of a submitted assessment: correct values, approve as baseline, or request a revision. */
export default function AssessmentReview() {
  const { assessmentId } = useParams();
  const assessment = useApi(() => therapistApi.assessment(assessmentId), [assessmentId]);
  const history = useApi(() => therapistApi.assessmentHistory(assessmentId), [assessmentId]);
  const library = useApi(() => therapistApi.library(true), []);
  const { user } = useAuth();
  const [correcting, setCorrecting] = useState(null); // { item, measurement }
  const [decision, setDecision] = useState({ comment: "", busy: false, error: null });

  const reload = () => { assessment.reload(); history.reload(); };
  const a = assessment.data;
  if (assessment.loading && !a) return <main className="page"><Spinner /></main>;
  if (assessment.error) return <main className="page"><ErrorState message={assessment.error} onRetry={assessment.reload} /></main>;

  const reviewable = ["SUBMITTED", "PENDING_REVIEW"].includes(a.status) && user?.role === "THERAPIST";
  const paramsOf = (exerciseId) => (library.data || []).find((e) => e.id === exerciseId)?.parameters || [];

  async function decide(kind) {
    if (kind === "revision" && !decision.comment.trim()) return setDecision({ ...decision, error: "Explain what the patient should change." });
    const question = kind === "approve"
      ? `Approve this assessment${a.type === "INITIAL" ? " as the patient's baseline" : ""}? It cannot be changed afterwards.`
      : "Send this assessment back to the patient for revision?";
    if (!window.confirm(question)) return;
    setDecision({ ...decision, busy: true, error: null });
    try {
      if (kind === "approve") await therapistApi.approveAssessment(a.id, decision.comment.trim() || null);
      else await therapistApi.requestAssessmentRevision(a.id, decision.comment.trim());
      setDecision({ comment: "", busy: false, error: null });
      reload();
    } catch (err) {
      setDecision({ ...decision, busy: false, error: errorMessage(err) });
    }
  }

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p><Link to={`/patients/${a.patientId}?tab=assessments`}>← {a.patientName}</Link></p>
          <h1>{ASSESSMENT_TYPE_LABELS[a.type]} assessment #{a.id}</h1>
          <div className="row">
            <span className={`badge ${ASSESSMENT_STATUS_TONES[a.status]}`}>{ASSESSMENT_STATUS_LABELS[a.status]}</span>
            {a.isBaseline && <span className="badge success">Baseline</span>}
            <span className="small muted">Recorded by {a.createdBy}{a.submittedAt ? ` · submitted ${formatDateTime(a.submittedAt)}` : ""}</span>
          </div>
        </div>
      </div>
      {a.reviewComment && <div className="alert info" style={{ marginBottom: 16 }}><strong>{a.reviewedBy}:</strong> {a.reviewComment}</div>}
      {!reviewable && user?.role === "ADMIN" && <div className="alert info" style={{ marginBottom: 16 }}>Read-only: clinical review belongs to the patient&apos;s assigned physiotherapist.</div>}

      <AssessmentReadOnly
        assessment={a}
        renderMeasurementActions={reviewable ? (item, m) => !m.superseded && (
          <button type="button" className="btn ghost sm" onClick={() => setCorrecting({ item, measurement: m })}>Correct</button>
        ) : undefined}
      />

      {correcting && (
        <CorrectionForm assessment={a} target={correcting} parameters={paramsOf(correcting.item.exerciseId)}
          onCancel={() => setCorrecting(null)} onSaved={() => { setCorrecting(null); reload(); }} />
      )}
      {reviewable && !correcting && (
        <AddMeasurement assessment={a} library={library.data || []} onSaved={reload} />
      )}

      {reviewable && (
        <section className="card" style={{ marginTop: 16 }}>
          <h2>Decision</h2>
          <p className="small muted">Approving records these values as measured capabilities. It does not clear the patient for any exercise: you approve prescriptions separately.</p>
          <Field label="Comment for the patient" htmlFor="rev-comment" help="Required when requesting a revision.">
            <textarea id="rev-comment" className="input" rows={2} maxLength={2000} value={decision.comment} onChange={(e) => setDecision({ ...decision, comment: e.target.value })} />
          </Field>
          {decision.error && <div className="alert error" style={{ marginBottom: 12 }}>{decision.error}</div>}
          <div className="row">
            <button type="button" className="btn" disabled={decision.busy} onClick={() => decide("approve")}>Approve{a.type === "INITIAL" ? " as baseline" : ""}</button>
            <button type="button" className="btn secondary" disabled={decision.busy} onClick={() => decide("revision")}>Request revision</button>
          </div>
        </section>
      )}

      <section className="card" style={{ marginTop: 16 }}>
        <h2>Audit trail</h2>
        <ul className="list">
          {(history.data || []).map((h) => (
            <li key={h.id} className="list-item" style={{ alignItems: "flex-start" }}>
              <div className="main">
                <div className="title small">{h.summary}</div>
                <div className="sub">{h.actorName} · {formatDateTime(h.createdAt)}</div>
                {h.details && <details className="panel small"><summary>Details</summary><pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{JSON.stringify(h.details, null, 2)}</pre></details>}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function CorrectionForm({ assessment, target, parameters, onCancel, onSaved }) {
  const param = parameters.find((p) => p.id === target.measurement.parameterId);
  const m = target.measurement;
  const [values, setValues] = useState({ [m.parameterId]: { value: m.value ?? "", valueMin: m.valueMin ?? "", valueMax: m.valueMax ?? "" } });
  const [note, setNote] = useState("");
  const [state, setState] = useState({ busy: false, error: null, errors: {} });

  async function save() {
    const errors = validateMeasurements([param], values, { requireAll: true });
    if (Object.keys(errors).length || !note.trim()) return setState({ busy: false, error: note.trim() ? null : "Explain the correction.", errors });
    setState({ busy: true, error: null, errors: {} });
    const [payload] = measurementPayload([param], values);
    try {
      await therapistApi.correctAssessment(assessment.id, { correctsMeasurementId: m.id, exerciseId: target.item.exerciseId, ...payload, note: note.trim() });
      onSaved();
    } catch (err) {
      setState({ busy: false, error: errorMessage(err), errors: {} });
    }
  }
  if (!param) return null;
  return (
    <section className="card" style={{ marginTop: 16 }}>
      <h2>Correct {m.label} ({target.item.exerciseName})</h2>
      <p className="small muted">The original value is kept in the record and marked as corrected.</p>
      <MeasurementFields parameters={[param]} values={values} onChange={setValues} errors={state.errors} idPrefix="corr" />
      <Field label="Reason / how it was measured" htmlFor="corr-note"><input id="corr-note" className="input" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      {state.error && <div className="alert error" style={{ marginBottom: 12 }}>{state.error}</div>}
      <div className="row">
        <button type="button" className="btn" disabled={state.busy} onClick={save}>Save correction</button>
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </section>
  );
}

/** Adds a therapist-measured value for a parameter the patient did not measure. */
function AddMeasurement({ assessment, library, onSaved }) {
  const [open, setOpen] = useState(false);
  const [exerciseId, setExerciseId] = useState(assessment.items[0]?.exerciseId ? String(assessment.items[0].exerciseId) : "");
  const [parameterId, setParameterId] = useState("");
  const [values, setValues] = useState({});
  const [note, setNote] = useState("");
  const [state, setState] = useState({ busy: false, error: null });
  const exercise = library.find((e) => String(e.id) === exerciseId);
  const item = assessment.items.find((i) => String(i.exerciseId) === exerciseId);
  const taken = new Set((item?.measurements || []).filter((m) => !m.superseded).map((m) => m.parameterId));
  const options = (exercise?.parameters || []).filter((p) => p.active && !taken.has(p.id));
  const param = options.find((p) => String(p.id) === parameterId);

  if (!open) return <div style={{ marginTop: 12 }}><button type="button" className="btn secondary sm" onClick={() => setOpen(true)}>Add a therapist measurement</button></div>;
  async function save() {
    if (!param) return setState({ busy: false, error: "Choose a measurement." });
    const errors = validateMeasurements([param], values, { requireAll: true });
    if (Object.keys(errors).length || !note.trim()) return setState({ busy: false, error: Object.values(errors)[0] || "Add a note on how it was measured." });
    setState({ busy: true, error: null });
    const [payload] = measurementPayload([param], values);
    try {
      await therapistApi.correctAssessment(assessment.id, { exerciseId: Number(exerciseId), ...payload, note: note.trim() });
      setOpen(false);
      setValues({});
      setNote("");
      setState({ busy: false, error: null });
      onSaved();
    } catch (err) {
      setState({ busy: false, error: errorMessage(err) });
    }
  }
  return (
    <section className="card" style={{ marginTop: 16 }}>
      <h2>Add a therapist measurement</h2>
      <div className="grid cols-2" style={{ gap: 0, columnGap: 12 }}>
        <Field label="Exercise" htmlFor="add-ex">
          <select id="add-ex" className="input" value={exerciseId} onChange={(e) => { setExerciseId(e.target.value); setParameterId(""); }}>
            {library.filter((e) => e.active).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </Field>
        <Field label="Measurement" htmlFor="add-param">
          <select id="add-param" className="input" value={parameterId} onChange={(e) => setParameterId(e.target.value)}>
            <option value="">Choose…</option>
            {options.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </Field>
      </div>
      {param && <MeasurementFields parameters={[param]} values={values} onChange={setValues} idPrefix="add" />}
      <Field label="How it was measured" htmlFor="add-note"><input id="add-note" className="input" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      {state.error && <div className="alert error" style={{ marginBottom: 12 }}>{state.error}</div>}
      <div className="row">
        <button type="button" className="btn" disabled={state.busy} onClick={save}>Add measurement</button>
        <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </section>
  );
}
