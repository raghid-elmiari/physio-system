import { Link } from "react-router-dom";
import { exercisesApi, patientApi, sessionsApi } from "../api/services";
import { ASSESSMENT_STATUS_LABELS, ASSESSMENT_STATUS_TONES } from "../lib/clinicalLabels";
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
  const assessment = useApi(() => patientApi.assessmentStatus(), []);

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
        {assessment.data && <AssessmentCard status={assessment.data} />}
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
                Your physiotherapist has not prescribed exercises yet. Complete your <Link to="/assessment">physical assessment</Link> so they can plan your program.
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

const ASSESSMENT_HINT = {
  NOT_STARTED: "Record what you can currently do so your physiotherapist can set your starting point.",
  IN_PROGRESS: "Your assessment draft is saved. Finish and submit it.",
  SUBMITTED: "Submitted. It will be reviewed once a physiotherapist is assigned to you.",
  PENDING_REVIEW: "Submitted. Your physiotherapist will review it.",
  REVISION_REQUESTED: "Your physiotherapist asked you to revise your assessment.",
};

/** Shown until the baseline is approved (and whenever a revision is requested). */
function AssessmentCard({ status }) {
  if (status.status === "APPROVED") return null;
  const action = status.status === "NOT_STARTED" ? "Start assessment" : status.status === "IN_PROGRESS" || status.status === "REVISION_REQUESTED" ? "Continue" : "View";
  const to = status.currentAssessmentId && !status.canStartNew ? `/assessment/${status.currentAssessmentId}` : "/assessment";
  return (
    <section className="card status-banner" aria-labelledby="assess-h">
      <div className="row">
        <h2 id="assess-h" style={{ margin: 0 }}>Physical assessment</h2>
        <span className={`badge ${ASSESSMENT_STATUS_TONES[status.status] ?? ""}`}>{ASSESSMENT_STATUS_LABELS[status.status]}</span>
        <span className="spacer" />
        <Link className="btn sm" to={to}>{action}</Link>
      </div>
      <p className="small muted" style={{ margin: "8px 0 0" }}>{ASSESSMENT_HINT[status.status]}</p>
    </section>
  );
}
