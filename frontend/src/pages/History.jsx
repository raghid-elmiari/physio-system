import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { sessionsApi } from "../api/services";
import { useApi } from "../lib/useApi";
import { formatDateTime, formatDuration, sessionAccuracy } from "../lib/format";
import { AccuracyBadge, EmptyState, ErrorState, Spinner, StatusBadge } from "../components/ui";
import { offlineQueue } from "../platform/sync";

export default function History() {
  const sessions = useApi(() => sessionsApi.history(), []);
  const [exerciseFilter, setExerciseFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const pending = offlineQueue.list();

  const exercises = useMemo(() => {
    const m = new Map();
    for (const s of sessions.data || []) m.set(s.exerciseId, s.exerciseName);
    return [...m.entries()];
  }, [sessions.data]);

  const rows = (sessions.data || []).filter(
    (s) => (!exerciseFilter || String(s.exerciseId) === exerciseFilter) && (!statusFilter || s.status === statusFilter)
  );

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Session history</h1>
          <p>Every session you have started, newest first.</p>
        </div>
        <div className="row">
          <select className="input" aria-label="Filter by exercise" value={exerciseFilter} onChange={(e) => setExerciseFilter(e.target.value)}>
            <option value="">All exercises</option>
            {exercises.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          <select className="input" aria-label="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="COMPLETED">Completed</option>
            <option value="ABORTED">Interrupted</option>
            <option value="IN_PROGRESS">In progress</option>
          </select>
        </div>
      </div>

      {pending.length > 0 && (
        <div className="alert warning" style={{ marginBottom: 16 }}>
          {pending.length} session{pending.length > 1 ? "s" : ""} recorded offline {pending.length > 1 ? "are" : "is"} waiting to upload. They will appear here once the server is reachable.
        </div>
      )}

      <div className="card">
        {sessions.loading && <Spinner label="Loading history…" />}
        {sessions.error && <ErrorState message={sessions.error} onRetry={sessions.reload} />}
        {sessions.data && rows.length === 0 && (
          <EmptyState icon="📋" title={sessions.data.length ? "No sessions match these filters" : "No sessions yet"}>
            {sessions.data.length ? "Clear the filters to see everything." : <Link to="/exercises">Start your first exercise</Link>}
          </EmptyState>
        )}
        {rows.length > 0 && (
          <div className="table-wrap">
            <table className="table responsive">
              <thead>
                <tr>
                  <th>Exercise</th>
                  <th>Date</th>
                  <th>Reps</th>
                  <th>Duration</th>
                  <th>Result</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td className="primary">{s.exerciseName}</td>
                    <td className="muted">{formatDateTime(s.startedAt)}</td>
                    <td data-label="Reps">{s.roundsCompleted}/{s.roundsRequested}</td>
                    <td data-label="Time">{formatDuration(s.durationSeconds)}</td>
                    <td>{s.status === "COMPLETED" ? <AccuracyBadge value={sessionAccuracy(s)} /> : <StatusBadge status={s.status} />}</td>
                    <td>{s.status === "COMPLETED" && <Link to={`/reports/${s.id}`}>Report</Link>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
