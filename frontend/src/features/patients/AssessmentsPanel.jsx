import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { errorMessage } from "../../api/client";
import { therapistApi } from "../../api/services";
import { useApi } from "../../lib/useApi";
import { formatDateTime } from "../../lib/format";
import { ASSESSMENT_STATUS_LABELS, ASSESSMENT_STATUS_TONES, ASSESSMENT_TYPE_LABELS } from "../../lib/clinicalLabels";
import { EmptyState, ErrorState, Spinner } from "../../components/ui";
import AssessmentForm from "../assessment/AssessmentForm";
import { assessmentPayload, validateAssessment } from "../assessment/assessmentModel";

/** The patient's assessments; the treating therapist can also record one they measured. */
export default function AssessmentsPanel({ patientId, canDecide }) {
  const list = useApi(() => therapistApi.patientAssessments(patientId), [patientId]);
  const [recording, setRecording] = useState(false);
  const hasBaseline = (list.data || []).some((a) => a.isBaseline);
  const open = (list.data || []).some((a) => ["IN_PROGRESS", "SUBMITTED", "PENDING_REVIEW", "REVISION_REQUESTED"].includes(a.status));

  return (
    <div className="stack">
      {recording && <RecordAssessment patientId={patientId} type={hasBaseline ? "FOLLOW_UP" : "INITIAL"} onCancel={() => setRecording(false)} />}
      <section className="card">
        <div className="card-head">
          <h2>Assessments</h2>
          {canDecide && !recording && !open && (
            <button type="button" className="btn secondary sm" onClick={() => setRecording(true)}>Record {hasBaseline ? "follow-up" : "initial"} assessment</button>
          )}
        </div>
        {list.loading && <Spinner />}
        {list.error && <ErrorState message={list.error} onRetry={list.reload} />}
        {list.data?.length === 0 && <EmptyState icon="📋" title="No assessments yet">The patient records their initial assessment from their dashboard.</EmptyState>}
        <ul className="list">
          {(list.data || []).map((a) => (
            <li key={a.id} className="list-item">
              <div className="main">
                <div className="title">
                  <Link to={`/therapist/assessments/${a.id}`}>{ASSESSMENT_TYPE_LABELS[a.type]} #{a.id}</Link>{" "}
                  {a.isBaseline && <span className="badge success">Baseline</span>}{" "}
                  {a.flaggedMeasurements > 0 && <span className="badge warning">{a.flaggedMeasurements} to check</span>}
                </div>
                <div className="sub">{a.exerciseCount} exercise(s){a.submittedAt ? ` · submitted ${formatDateTime(a.submittedAt)}` : ""}{a.approvedAt ? ` · approved ${formatDateTime(a.approvedAt)}` : ""}</div>
              </div>
              <span className={`badge ${ASSESSMENT_STATUS_TONES[a.status] ?? ""}`}>{ASSESSMENT_STATUS_LABELS[a.status]}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function RecordAssessment({ patientId, type, onCancel }) {
  const exercises = useApi(() => therapistApi.library(false), []);
  const [form, setForm] = useState({ notes: "", items: [] });
  const [state, setState] = useState({ busy: false, error: null });
  const navigate = useNavigate();
  const assessable = (exercises.data || []).filter((e) => e.parameters.some((p) => p.active && p.assessmentEnabled));

  async function save() {
    const problem = validateAssessment(form, assessable, { submit: true });
    if (problem) return setState({ busy: false, error: problem });
    setState({ busy: true, error: null });
    try {
      const payload = assessmentPayload(form, assessable);
      const created = await therapistApi.recordAssessment(patientId, { type, notes: payload.notes, items: payload.items });
      navigate(`/therapist/assessments/${created.id}`);
    } catch (err) {
      setState({ busy: false, error: errorMessage(err) });
    }
  }

  return (
    <section className="card">
      <h2>Record {type === "INITIAL" ? "initial (baseline)" : "follow-up"} assessment</h2>
      <p className="small muted">Values are saved as therapist-measured. You review and approve it on the next screen.</p>
      {exercises.loading ? <Spinner /> : <AssessmentForm form={form} onChange={setForm} exercises={assessable} notesLabel="Clinical notes" />}
      {state.error && <div className="alert error" style={{ marginTop: 12 }}>{state.error}</div>}
      <div className="row" style={{ marginTop: 12 }}>
        <button type="button" className="btn" disabled={state.busy} onClick={save}>{state.busy ? "Saving…" : "Save for review"}</button>
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </section>
  );
}
