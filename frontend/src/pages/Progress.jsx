import { useState } from "react";
import { Link } from "react-router-dom";
import { myReportsApi, sessionsApi } from "../api/services";
import { useApi } from "../lib/useApi";
import { formatCalendarDate } from "../lib/format";
import ProgressView from "../components/ProgressView";
import { ErrorState, Spinner } from "../components/ui";

export default function Progress() {
  const [days, setDays] = useState(90);
  const progress = useApi(() => sessionsApi.progress(days), [days]);

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Your progress</h1>
          <p>How your accuracy and volume have changed over time.</p>
        </div>
        <select className="input" style={{ maxWidth: 180 }} aria-label="Time range" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
          <option value={365}>Last year</option>
        </select>
      </div>
      {progress.loading && <Spinner label="Loading progress…" />}
      {progress.error && <ErrorState message={progress.error} onRetry={progress.reload} />}
      {progress.data && <ProgressView data={progress.data} />}
      <SharedReports />
    </main>
  );
}

/** Reports the physiotherapist chose to share; hidden when there are none. */
function SharedReports() {
  const reports = useApi(() => myReportsApi.list(), []);
  if (!reports.data?.length) return null;
  return (
    <section className="card" style={{ marginTop: 16 }}>
      <h2>Reports from your physiotherapist</h2>
      <ul className="list">
        {reports.data.map((report) => (
          <li key={report.id} className="list-item">
            <div className="main">
              <div className="title"><Link to={`/my-reports/${report.id}`}>{report.title}</Link></div>
              <div className="sub">
                {formatCalendarDate(report.periodStart)} – {formatCalendarDate(report.periodEnd)}{report.authorName ? ` · ${report.authorName}` : ""}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
