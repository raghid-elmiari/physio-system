import { Link } from "react-router-dom";
import { exercisesApi, sessionsApi } from "../api/services";
import { useAuth } from "../context/AuthContext";
import { useApi } from "../lib/useApi";
import { formatDateTime, relativeDay, sessionAccuracy } from "../lib/format";
import { AccuracyBadge, EmptyState, ErrorState, Spinner, StatTile, StatusBadge } from "../components/ui";
import ExerciseCard from "../components/ExerciseCard";
import ProgressChart from "../components/ProgressChart";

export default function Dashboard() {
  const { user } = useAuth();
  const assignments = useApi(() => exercisesApi.myAssignments(), []);
  const progress = useApi(() => sessionsApi.progress(30), []);
  const sessions = useApi(() => sessionsApi.history(), []);

  const totals = progress.data?.totals;
  const recent = (sessions.data || []).slice(0, 5);
  const lastSession = sessions.data?.[0];

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Hello, {user?.firstName}</h1>
          <p>{lastSession ? `Last session ${relativeDay(lastSession.startedAt)}.` : "Ready for your first session?"}</p>
        </div>
        <Link className="btn secondary" to="/exercises">Exercise library</Link>
      </div>

      <div className="stack">
        {progress.error ? (
          <ErrorState message={progress.error} onRetry={progress.reload} />
        ) : (
          <div className="grid cols-4">
            <StatTile label="Sessions (30 days)" value={progress.loading ? "…" : totals?.completedSessions} hint={totals ? `${totals.sessionsLast7Days} in the last 7 days` : null} />
            <StatTile label="Repetitions" value={progress.loading ? "…" : totals?.totalReps} hint={totals ? `${totals.correctReps} performed correctly` : null} />
            <StatTile label="Average accuracy" value={progress.loading ? "…" : totals?.averageAccuracyPct != null ? `${Math.round(totals.averageAccuracyPct)}%` : "—"} />
            <StatTile label="Day streak" value={progress.loading ? "…" : totals?.activeDaysStreak} hint={totals ? `${totals.totalMinutes} active minutes` : null} />
          </div>
        )}

        <section className="stack" aria-labelledby="program-h">
          <h2 id="program-h">Your program</h2>
          {assignments.loading && <Spinner label="Loading your exercises…" />}
          {assignments.error && <ErrorState message={assignments.error} onRetry={assignments.reload} />}
          {assignments.data && assignments.data.length === 0 && (
            <div className="card">
              <EmptyState icon="🗒" title="No exercises assigned yet">
                Your therapist has not assigned a program yet. You can still practise from the <Link to="/exercises">exercise library</Link>.
              </EmptyState>
            </div>
          )}
          {assignments.data && assignments.data.length > 0 && (
            <div className="grid cols-2">
              {assignments.data.map((a) => (
                <ExerciseCard key={a.id} exercise={a.exercise} assignment={a} />
              ))}
            </div>
          )}
        </section>

        <div className="grid cols-2">
          <section className="card" aria-labelledby="trend-h">
            <div className="card-head">
              <h2 id="trend-h">Accuracy trend</h2>
              <Link to="/progress" className="small">Details</Link>
            </div>
            {progress.loading ? <div className="skeleton" style={{ height: 160 }} /> : <ProgressChart points={progress.data?.timeline} height={180} />}
          </section>

          <section className="card" aria-labelledby="recent-h">
            <div className="card-head">
              <h2 id="recent-h">Recent sessions</h2>
              <Link to="/history" className="small">All history</Link>
            </div>
            {sessions.loading && <Spinner />}
            {sessions.error && <ErrorState message={sessions.error} onRetry={sessions.reload} />}
            {sessions.data && recent.length === 0 && <EmptyState title="No sessions yet">Start one from your program above.</EmptyState>}
            <ul className="list">
              {recent.map((s) => (
                <li key={s.id} className="list-item">
                  <div className="main">
                    <div className="title">{s.exerciseName}</div>
                    <div className="sub">{formatDateTime(s.startedAt)} · {s.roundsCompleted}/{s.roundsRequested} reps</div>
                  </div>
                  {s.status === "COMPLETED" ? (
                    <Link to={`/reports/${s.id}`}>
                      <AccuracyBadge value={sessionAccuracy(s)} />
                    </Link>
                  ) : (
                    <StatusBadge status={s.status} />
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </main>
  );
}
