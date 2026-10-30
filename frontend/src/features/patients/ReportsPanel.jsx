import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { errorMessage } from "../../api/client";
import { therapistApi } from "../../api/services";
import { useApi } from "../../lib/useApi";
import { formatCalendarDate, formatDateTime, lastDaysRange } from "../../lib/format";
import { EmptyState, ErrorState, Field, Spinner } from "../../components/ui";
import DateRangePicker from "./DateRangePicker";

/** The patient's stored reports, and a form to generate a new one for a date range. */
export default function ReportsPanel({ patientId }) {
  const navigate = useNavigate();
  const reports = useApi(() => therapistApi.reports(patientId), [patientId]);
  const [range, setRange] = useState(() => lastDaysRange(30));
  const [title, setTitle] = useState("");
  const [state, setState] = useState({ busy: false, error: null });

  async function handleGenerateReport(e) {
    e.preventDefault();
    if (!range.from || !range.to || range.from > range.to) {
      return setState({ busy: false, error: "Choose a start date on or before the end date." });
    }
    setState({ busy: true, error: null });
    try {
      const report = await therapistApi.generateReport(patientId, { from: range.from, to: range.to, title: title.trim() || null });
      navigate(`/therapist/reports/${report.id}`);
    } catch (err) {
      setState({ busy: false, error: errorMessage(err) });
    }
  }

  return (
    <div className="stack">
      <form className="card" onSubmit={handleGenerateReport} noValidate>
        <h2>Generate a report</h2>
        <p className="small muted">
          The report captures the recorded sessions for the chosen period. You then add your observations, recommendations,
          exercise modifications and follow-up instructions, and decide whether the patient can see it.
        </p>
        <DateRangePicker value={range} onChange={setRange} idPrefix="report" />
        <Field label="Title (optional)" htmlFor="report-title">
          <input id="report-title" className="input" maxLength={200} placeholder="e.g. 4-week review" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        {state.error && <div className="alert error" style={{ marginBottom: 12 }}>{state.error}</div>}
        <button type="submit" className="btn" disabled={state.busy}>{state.busy ? "Generating…" : "Generate report"}</button>
      </form>

      <section className="card">
        <h2>Previous reports</h2>
        {reports.loading && <Spinner />}
        {reports.error && <ErrorState message={reports.error} onRetry={reports.reload} />}
        {reports.data?.length === 0 && <EmptyState icon="📄" title="No reports yet">Generated reports are listed here.</EmptyState>}
        <ul className="list">
          {(reports.data || []).map((report) => (
            <li key={report.id} className="list-item">
              <div className="main">
                <div className="title"><Link to={`/therapist/reports/${report.id}`}>{report.title}</Link></div>
                <div className="sub">
                  {formatCalendarDate(report.periodStart)} – {formatCalendarDate(report.periodEnd)} · created {formatDateTime(report.createdAt)}
                  {report.authorName ? ` by ${report.authorName}` : ""}
                </div>
              </div>
              {report.sharedWithPatient ? <span className="badge success">Shared with patient</span> : <span className="badge">Not shared</span>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
