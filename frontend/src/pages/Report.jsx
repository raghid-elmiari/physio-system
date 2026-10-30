import { Link, useNavigate, useParams } from "react-router-dom";
import { sessionsApi } from "../api/services";
import { useApi } from "../lib/useApi";
import { formatDateTime, formatDuration } from "../lib/format";
import { ErrorState, Spinner, StatTile } from "../components/ui";
import { METRIC_LABELS } from "../lib/clinicalLabels";
import { useAuth } from "../context/AuthContext";

export default function Report() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const viewedByStaff = user?.role === "THERAPIST" || user?.role === "ADMIN";
  const report = useApi(() => sessionsApi.report(sessionId), [sessionId]);
  const events = useApi(() => sessionsApi.events(sessionId), [sessionId]);

  if (report.loading) return <main className="page"><Spinner label="Loading report…" /></main>;
  if (report.error) return <main className="page"><ErrorState message={report.error} onRetry={report.reload} /></main>;

  const r = report.data;
  const mistakes = r.commonMistakes || [];
  const maxCount = Math.max(1, ...mistakes.map((m) => m.count));
  const metrics = Object.entries(r.metrics || {}).filter(([k, v]) => METRIC_LABELS[k] && v != null);
  const reps = (events.data || []).filter((e) => e.eventType === "REP_COMPLETED" || e.eventType === "REP_INCOMPLETE");
  // Rep events store error codes ("errors: ELBOW_BENT,TRUNK_LEAN"); show the coaching text instead.
  const messageFor = Object.fromEntries(mistakes.map((m) => [m.code, m.message || m.code]));
  const repErrors = (msg) =>
    (msg || "").replace(/^errors: /, "").split(",").filter(Boolean).map((c) => messageFor[c] || c).join(" ");

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p>
            {viewedByStaff
              ? <button type="button" className="btn ghost sm" onClick={() => navigate(-1)}>← Back to patient</button>
              : <Link to="/history">← History</Link>}
          </p>
          <h1>{r.exerciseName}</h1>
          <p>{formatDateTime(r.startedAt)}</p>
        </div>
        {!viewedByStaff && <Link className="btn" to={`/session/live/${r.exerciseId}`}>Do it again</Link>}
      </div>

      <div className="stack">
        <div className="grid cols-4">
          <StatTile label="Accuracy" value={`${Math.round(Number(r.accuracyPct))}%`} hint="Reps without a detected error" />
          <StatTile label="Repetitions" value={`${r.totalReps}/${r.roundsRequested}`} />
          <StatTile label="Performed correctly" value={r.correctReps ?? "—"} />
          <StatTile label="Duration" value={formatDuration(r.durationSeconds)} />
        </div>

        <div className="grid cols-2">
          <section className="card">
            <h2>Most common corrections</h2>
            {mistakes.length === 0 ? (
              <p className="muted">No movement errors were detected in this session.</p>
            ) : (
              <div className="bars">
                {mistakes.map((m) => (
                  <div key={m.code} className="bar-row">
                    <span>{m.message || m.code}</span>
                    <span className="track"><span className="fill" style={{ width: `${(m.count / maxCount) * 100}%`, display: "block" }} /></span>
                    <strong>{m.count}×</strong>
                  </div>
                ))}
              </div>
            )}
          </section>
          <section className="card">
            <h2>Measurements</h2>
            {metrics.length === 0 ? <p className="muted">No measurements were recorded.</p> : (
              <div className="metric-grid">
                {metrics.map(([k, v]) => (
                  <div key={k} className="metric">
                    <div className="k">{METRIC_LABELS[k][0]}</div>
                    <div className="v">{METRIC_LABELS[k][1](v)}</div>
                  </div>
                ))}
              </div>
            )}
            <p className="small muted" style={{ marginTop: 10 }}>Measured from camera landmarks on your device; not a clinical measurement.</p>
          </section>
        </div>

        <section className="card">
          <h2>Repetition timeline</h2>
          {events.loading && <Spinner />}
          {events.data && reps.length === 0 && <p className="muted">No repetition events were recorded.</p>}
          <ul className="list">
            {reps.map((e) => (
              <li key={`${e.sequenceNo}`} className="list-item">
                <div className="main">
                  <div className="title">{e.eventType === "REP_COMPLETED" ? `Repetition ${e.repNumber}` : "Attempt not counted"}</div>
                  <div className="sub">
                    {e.value != null && `Top angle ${Math.round(e.value)}° · `}
                    {e.eventType === "REP_COMPLETED" ? (e.message === "correct" ? "No errors" : repErrors(e.message)) : e.message}
                  </div>
                </div>
                <span className={`badge ${e.eventType === "REP_COMPLETED" ? (e.message === "correct" ? "success" : "warning") : "danger"}`}>
                  {e.eventType === "REP_COMPLETED" ? (e.message === "correct" ? "Correct" : "With errors") : "Incomplete"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
