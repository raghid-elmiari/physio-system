import { Link, useParams } from "react-router-dom";
import { myReportsApi } from "../api/services";
import { useApi } from "../lib/useApi";
import { formatCalendarDate } from "../lib/format";
import { ErrorState, Spinner } from "../components/ui";
import PatientReportDocument from "../features/reports/PatientReportDocument";
import { downloadPatientReportPdf } from "../features/reports/patientReportPdf";

/** A report the patient's physiotherapist has shared with them (read-only). */
export default function MyReport() {
  const { reportId } = useParams();
  const report = useApi(() => myReportsApi.get(reportId), [reportId]);

  if (report.loading) return <main className="page"><Spinner label="Loading report…" /></main>;
  if (report.error) return <main className="page"><ErrorState message={report.error} onRetry={report.reload} /></main>;
  const r = report.data;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="no-print"><Link to="/progress">← Progress</Link></p>
          <h1>{r.title}</h1>
          <p>{formatCalendarDate(r.periodStart)} – {formatCalendarDate(r.periodEnd)}{r.authorName ? ` · from ${r.authorName}` : ""}</p>
        </div>
        <div className="row no-print">
          <button type="button" className="btn secondary" onClick={() => downloadPatientReportPdf(r)}>Download PDF</button>
          <button type="button" className="btn secondary" onClick={() => window.print()}>Print</button>
        </div>
      </div>
      <PatientReportDocument report={r} linkSessions />
    </main>
  );
}
