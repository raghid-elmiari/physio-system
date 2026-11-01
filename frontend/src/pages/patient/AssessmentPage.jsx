import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { errorMessage } from "../../api/client";
import { patientApi } from "../../api/services";
import { useApi } from "../../lib/useApi";
import { formatDateTime } from "../../lib/format";
import { ASSESSMENT_STATUS_LABELS, ASSESSMENT_STATUS_TONES, ASSESSMENT_TYPE_LABELS } from "../../lib/clinicalLabels";
import { EmptyState, ErrorState, Spinner } from "../../components/ui";
import AssessmentForm, { AssessmentReadOnly } from "../../features/assessment/AssessmentForm";
import { assessmentPayload, formStateFromAssessment, validateAssessment } from "../../features/assessment/assessmentModel";

/** /assessment: status and list. /assessment/:id: one assessment (form while editable). */
export default function AssessmentPage() {
  const { assessmentId } = useParams();
  return assessmentId ? <AssessmentDetail id={assessmentId} /> : <AssessmentOverview />;
}

function AssessmentOverview() {
  const status = useApi(() => patientApi.assessmentStatus(), []);
  const list = useApi(() => patientApi.assessments(), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const created = await patientApi.startAssessment();
      navigate(`/assessment/${created.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  const s = status.data;
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Physical assessment</h1>
          <p>Record what you can currently do. Your physiotherapist reviews it and uses it as your starting point (baseline).</p>
        </div>
        {s?.canStartNew && (
          <button type="button" className="btn" disabled={busy} onClick={start}>
            {busy ? "Starting…" : s.nextType === "INITIAL" ? "Start initial assessment" : "Start follow-up assessment"}
          </button>
        )}
      </div>
      {error && <div className="alert error" style={{ marginBottom: 12 }}>{error}</div>}
      {status.loading && <Spinner />}
      {status.error && <ErrorState message={status.error} onRetry={status.reload} />}
      {s && (
        <section className={`card status-banner ${s.status === "APPROVED" ? "ok" : ""}`} style={{ marginBottom: 16 }}>
          <div className="row">
            <strong>Status:</strong>
            <span className={`badge ${ASSESSMENT_STATUS_TONES[s.status] ?? ""}`}>{ASSESSMENT_STATUS_LABELS[s.status] ?? s.status}</span>
            <span className="spacer" />
            {s.currentAssessmentId && !s.canStartNew && <Link className="btn secondary sm" to={`/assessment/${s.currentAssessmentId}`}>Open</Link>}
          </div>
          <p className="small muted" style={{ margin: "8px 0 0" }}>
            {s.status === "NOT_STARTED" && "You have not recorded an assessment yet."}
            {s.status === "IN_PROGRESS" && "Your draft is saved. Submit it when you are done."}
            {s.status === "SUBMITTED" && "Submitted. A physiotherapist will review it once one is assigned to you."}
            {s.status === "PENDING_REVIEW" && "Submitted. Your physiotherapist will review it."}
            {s.status === "REVISION_REQUESTED" && "Your physiotherapist asked you to change something. Open it to see their comment."}
            {s.status === "APPROVED" && "Your baseline is approved. Your physiotherapist decides when each exercise can start."}
          </p>
        </section>
      )}
      <section className="card">
        <h2>Your assessments</h2>
        {list.loading && <Spinner />}
        {list.error && <ErrorState message={list.error} onRetry={list.reload} />}
        {list.data?.length === 0 && <EmptyState icon="📋" title="No assessments yet">Start your initial assessment above.</EmptyState>}
        <ul className="list">
          {(list.data || []).map((a) => (
            <li key={a.id} className="list-item">
              <div className="main">
                <div className="title"><Link to={`/assessment/${a.id}`}>{ASSESSMENT_TYPE_LABELS[a.type]} assessment #{a.id}</Link> {a.isBaseline && <span className="badge success">Baseline</span>}</div>
                <div className="sub">{a.exerciseCount} exercise(s) · started {formatDateTime(a.createdAt)}{a.approvedAt ? ` · approved ${formatDateTime(a.approvedAt)}${a.reviewedBy ? ` by ${a.reviewedBy}` : ""}` : ""}</div>
              </div>
              <span className={`badge ${ASSESSMENT_STATUS_TONES[a.status] ?? ""}`}>{ASSESSMENT_STATUS_LABELS[a.status]}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function AssessmentDetail({ id }) {
  const assessment = useApi(() => patientApi.assessment(id), [id]);
  const exercises = useApi(() => patientApi.assessableExercises(), []);
  const history = useApi(() => patientApi.assessmentHistory(id), [id]);
  const a = assessment.data;
  const reload = () => { assessment.reload(); history.reload(); };

  if (assessment.loading && !a) return <main className="page"><Spinner /></main>;
  if (assessment.error) return <main className="page"><ErrorState message={assessment.error} onRetry={assessment.reload} /></main>;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p><Link to="/assessment">← Assessments</Link></p>
          <h1>{ASSESSMENT_TYPE_LABELS[a.type]} assessment</h1>
          <div className="row">
            <span className={`badge ${ASSESSMENT_STATUS_TONES[a.status] ?? ""}`}>{ASSESSMENT_STATUS_LABELS[a.status]}</span>
            {a.isBaseline && <span className="badge success">Your baseline</span>}
            {a.submittedAt && <span className="small muted">Submitted {formatDateTime(a.submittedAt)}</span>}
          </div>
        </div>
      </div>
      {a.reviewComment && (
        <div className={`alert ${a.status === "REVISION_REQUESTED" ? "warning" : "info"}`} style={{ marginBottom: 16 }}>
          <strong>{a.reviewedBy ?? "Your physiotherapist"}:</strong> {a.reviewComment}
        </div>
      )}
      {a.editable ? (
        exercises.loading ? <Spinner /> : exercises.error ? <ErrorState message={exercises.error} onRetry={exercises.reload} /> : (
          <AssessmentEditor key={`${a.id}-${a.status}`} assessment={a} exercises={exercises.data} onSaved={reload} />
        )
      ) : (
        <AssessmentReadOnly assessment={a} />
      )}
      <section className="card" style={{ marginTop: 16 }}>
        <h2>History</h2>
        {history.data?.length === 0 && <p className="muted small">No changes recorded yet.</p>}
        <ul className="list">
          {(history.data || []).map((h) => (
            <li key={h.id} className="list-item"><div className="main"><div className="title small">{h.summary}</div><div className="sub">{h.actorName} · {formatDateTime(h.createdAt)}</div></div></li>
          ))}
        </ul>
      </section>
    </main>
  );
}

/** Draft editor; re-mounted (fresh form state) whenever the stored assessment changes. */
function AssessmentEditor({ assessment, exercises, onSaved }) {
  const [form, setForm] = useState(() => formStateFromAssessment(assessment));
  const [state, setState] = useState({ busy: false, error: null, saved: false });

  async function save({ submit }) {
    const problem = validateAssessment(form, exercises, { submit });
    if (problem) return setState({ busy: false, error: problem, saved: false });
    if (submit && !window.confirm("Submit this assessment to your physiotherapist? You cannot change it while it is being reviewed.")) return;
    setState({ busy: true, error: null, saved: false });
    try {
      await patientApi.saveAssessment(assessment.id, assessmentPayload(form, exercises));
      if (submit) await patientApi.submitAssessment(assessment.id);
      setState({ busy: false, error: null, saved: !submit });
      onSaved();
    } catch (err) {
      setState({ busy: false, error: errorMessage(err), saved: false });
    }
  }

  return (
    <div className="stack">
      <div className="alert info small">
        Measure only what you can do safely. Stop if a movement causes sharp pain. Submitting does not mean you can start exercising:
        your physiotherapist approves each exercise separately.
      </div>
      <AssessmentForm form={form} onChange={setForm} exercises={exercises} />
      {state.error && <div className="alert error">{state.error}</div>}
      {state.saved && <div className="alert success">Draft saved.</div>}
      <div className="row">
        <button type="button" className="btn secondary" disabled={state.busy} onClick={() => save({ submit: false })}>Save draft</button>
        <button type="button" className="btn" disabled={state.busy} onClick={() => save({ submit: true })}>{state.busy ? "Saving…" : "Submit for review"}</button>
      </div>
    </div>
  );
}
