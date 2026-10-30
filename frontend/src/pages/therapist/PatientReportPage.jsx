import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { errorMessage } from "../../api/client";
import { therapistApi } from "../../api/services";
import { useApi } from "../../lib/useApi";
import { formatCalendarDate, formatDateTime } from "../../lib/format";
import { ErrorState, Field, Spinner } from "../../components/ui";
import PatientReportDocument, { ASSESSMENT_SECTIONS } from "../../features/reports/PatientReportDocument";
import { downloadPatientReportPdf } from "../../features/reports/patientReportPdf";

/** A stored report as the physiotherapist sees it: measurements, editable assessment, sharing, PDF and print. */
export default function PatientReportPage() {
  const { reportId } = useParams();
  const navigate = useNavigate();
  const report = useApi(() => therapistApi.report(reportId), [reportId]);
  const [actionState, setActionState] = useState({ busy: false, error: null });

  if (report.loading && !report.data) return <main className="page"><Spinner label="Loading report…" /></main>;
  if (report.error) return <main className="page"><ErrorState message={report.error} onRetry={report.reload} /></main>;
  const r = report.data;

  async function handleToggleSharing() {
    setActionState({ busy: true, error: null });
    try {
      await therapistApi.updateReport(r.id, { ...r.assessment, title: r.title, sharedWithPatient: !r.sharedWithPatient });
      setActionState({ busy: false, error: null });
      report.reload();
    } catch (err) {
      setActionState({ busy: false, error: errorMessage(err) });
    }
  }

  async function handleDeleteReport() {
    if (!window.confirm("Delete this report? This cannot be undone.")) return;
    try {
      await therapistApi.deleteReport(r.id);
      navigate(`/patients/${r.patientId}?tab=reports`, { replace: true });
    } catch (err) {
      setActionState({ busy: false, error: errorMessage(err) });
    }
  }

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="no-print"><Link to={`/patients/${r.patientId}?tab=reports`}>← {r.measurements.patient.name}</Link></p>
          <h1>{r.title}</h1>
          <p>
            {formatCalendarDate(r.periodStart)} – {formatCalendarDate(r.periodEnd)} ·{" "}
            {r.sharedWithPatient ? <span className="badge success">Shared with patient</span> : <span className="badge">Not shared with patient</span>}
          </p>
        </div>
        <div className="row no-print">
          <button type="button" className="btn secondary" onClick={() => downloadPatientReportPdf(r)}>Download PDF</button>
          <button type="button" className="btn secondary" onClick={() => window.print()}>Print</button>
          <button type="button" className="btn" disabled={actionState.busy} onClick={handleToggleSharing}>
            {r.sharedWithPatient ? "Stop sharing" : "Share with patient"}
          </button>
        </div>
      </div>
      {actionState.error && <div className="alert error no-print" style={{ marginBottom: 12 }}>{actionState.error}</div>}

      <PatientReportDocument
        report={r}
        linkSessions
        assessmentEditor={<AssessmentEditor key={r.updatedAt} report={r} onSaved={report.reload} />}
      />

      <div className="row no-print" style={{ marginTop: 16 }}>
        <span className="spacer small muted">Last updated {formatDateTime(r.updatedAt)}</span>
        <button type="button" className="btn ghost danger-text" onClick={handleDeleteReport}>Delete report</button>
      </div>
    </main>
  );
}

function AssessmentEditor({ report, onSaved }) {
  const [form, setForm] = useState(() => Object.fromEntries(ASSESSMENT_SECTIONS.map(([key]) => [key, report.assessment[key] ?? ""])));
  const [state, setState] = useState({ busy: false, error: null, saved: false });

  async function handleSaveAssessment(e) {
    e.preventDefault();
    setState({ busy: true, error: null, saved: false });
    try {
      await therapistApi.updateReport(report.id, { ...form, title: report.title, sharedWithPatient: report.sharedWithPatient });
      setState({ busy: false, error: null, saved: true });
      onSaved();
    } catch (err) {
      setState({ busy: false, error: errorMessage(err), saved: false });
    }
  }

  return (
    <form onSubmit={handleSaveAssessment} noValidate>
      {/* Screen: editable fields. Print: the saved text only. */}
      <div className="no-print">
        {ASSESSMENT_SECTIONS.map(([key, label]) => (
          <Field key={key} label={label} htmlFor={`assessment-${key}`}>
            <textarea id={`assessment-${key}`} className="input" rows={3} maxLength={4000} value={form[key]}
              onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
          </Field>
        ))}
        {state.error && <div className="alert error" style={{ marginBottom: 12 }}>{state.error}</div>}
        {state.saved && <div className="alert success" style={{ marginBottom: 12 }}>Assessment saved.</div>}
        <button type="submit" className="btn" disabled={state.busy}>{state.busy ? "Saving…" : "Save assessment"}</button>
      </div>
      <div className="print-only stack">
        {ASSESSMENT_SECTIONS.map(([key, label]) => (
          <div key={key}>
            <h3>{label}</h3>
            <p className="preserve-lines">{report.assessment[key] || "Not provided."}</p>
          </div>
        ))}
      </div>
    </form>
  );
}
