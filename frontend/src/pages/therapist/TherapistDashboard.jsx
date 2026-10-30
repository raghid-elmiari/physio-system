import { Link } from "react-router-dom";
import { therapistApi } from "../../api/services";
import { useAuth } from "../../context/AuthContext";
import { useApi } from "../../lib/useApi";
import { formatDate, formatDateTime, relativeDay } from "../../lib/format";
import { formatPercent } from "../../lib/clinicalLabels";
import { AccuracyBadge, EmptyState, ErrorState, Spinner, StatTile, StatusBadge } from "../../components/ui";
import ProgressChart from "../../components/ProgressChart";

export default function TherapistDashboard() {
  const { user } = useAuth();
  const overview = useApi(() => therapistApi.dashboard(), []);

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Welcome, {user?.firstName}</h1>
          <p>Your caseload at a glance. Figures come from the sessions your patients recorded.</p>
        </div>
        <div className="row">
          <Link className="btn secondary" to="/exercises">Exercise library</Link>
          <Link className="btn" to="/patients?add=new">Add patient</Link>
        </div>
      </div>

      {overview.loading && <Spinner label="Loading dashboard…" />}
      {overview.error && <ErrorState message={overview.error} onRetry={overview.reload} />}
      {overview.data && <DashboardContent data={overview.data} />}
    </main>
  );
}

function DashboardContent({ data }) {
  const { patients } = data;
  if (patients.total === 0) {
    return (
      <div className="card">
        <EmptyState icon="👥" title="No patients yet">
          <Link to="/patients?add=new">Add your first patient</Link> or link a patient who already registered.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="grid cols-4">
        <StatTile label="Registered patients" value={patients.total} hint={`${patients.disabledAccounts} deactivated`} />
        <StatTile label="Active patients" value={patients.active} hint="With an exercise program in force" />
        <StatTile label="Need attention" value={patients.needingAttention} hint={patients.needingAttention ? "See the list below" : "Nobody flagged"} />
        <StatTile label="Assigned exercises" value={data.activePrescriptions} hint="Prescriptions in force" />
      </div>
      <div className="grid cols-4">
        <StatTile label="Completed sessions" value={data.completedSessionsLast30Days} hint="Last 30 days" />
        <StatTile label="Interrupted sessions" value={data.interruptedSessionsLast30Days} hint="Last 30 days" />
        <StatTile label="Completed this week" value={data.sessionsCompletedThisWeek} hint="Since Monday" />
        <StatTile label="Pending this week" value={data.sessionsDueThisWeek} hint={`Avg accuracy (30 days): ${formatPercent(data.averageAccuracyLast30Days)}`} />
      </div>

      <div className="grid cols-2" style={{ alignItems: "start" }}>
        <section className="card" aria-labelledby="attention-h">
          <div className="card-head">
            <h2 id="attention-h">Patients requiring attention</h2>
            <Link to="/patients" className="small">All patients</Link>
          </div>
          {data.patientsNeedingAttention.length === 0 ? (
            <EmptyState icon="✓" title="Nobody needs attention">All patients with a program are training regularly.</EmptyState>
          ) : (
            <ul className="list">
              {data.patientsNeedingAttention.map((item) => (
                <li key={item.patientId} className="list-item">
                  <div className="main">
                    <div className="title"><Link to={`/patients/${item.patientId}`}>{item.patientName}</Link></div>
                    <div className="sub">{item.reasons.join(" · ")}</div>
                  </div>
                  <span className="badge warning" title={formatDateTime(item.lastSessionAt)}>Last: {relativeDay(item.lastSessionAt)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="small muted" style={{ marginTop: 8 }}>
            Flagged when a patient with an active program has no completed session for 7 days, averages under 60% accuracy over
            their last 3 sessions, or stopped 2+ sessions early this week.
          </p>
        </section>

        <section className="card" aria-labelledby="activity-h">
          <h2 id="activity-h">Recent patient activity</h2>
          {data.recentActivity.length === 0 ? (
            <EmptyState title="No sessions yet">Sessions appear here as patients exercise.</EmptyState>
          ) : (
            <ul className="list">
              {data.recentActivity.map((activity) => (
                <li key={activity.sessionId} className="list-item">
                  <div className="main">
                    <div className="title">
                      <Link to={`/patients/${activity.patientId}`}>{activity.patientName}</Link> · {activity.exerciseName}
                    </div>
                    <div className="sub">{formatDateTime(activity.startedAt)} · {activity.roundsCompleted}/{activity.roundsRequested} reps</div>
                  </div>
                  {activity.status === "COMPLETED" ? (
                    <Link to={`/reports/${activity.sessionId}`}><AccuracyBadge value={activity.accuracyPct} /></Link>
                  ) : (
                    <StatusBadge status={activity.status} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="grid cols-2">
        <section className="card" aria-labelledby="volume-h">
          <h2 id="volume-h">Completed sessions per week</h2>
          <WeeklySessionsChart points={data.weeklyProgress} />
        </section>
        <section className="card" aria-labelledby="quality-h">
          <h2 id="quality-h">Average accuracy per week</h2>
          <ProgressChart
            height={180}
            emptyMessage="The trend appears once patients have completed sessions in at least two weeks."
            points={data.weeklyProgress.map((week) => ({ date: week.weekStart, accuracyPct: week.averageAccuracyPct, exerciseName: "All patients" }))}
          />
        </section>
      </div>
    </div>
  );
}

/** Bar chart of completed sessions per week across the caseload (pure SVG). */
function WeeklySessionsChart({ points }) {
  const width = 640;
  const height = 180;
  const pad = { left: 30, right: 10, top: 14, bottom: 26 };
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = height - pad.top - pad.bottom;
  const max = Math.max(4, ...points.map((p) => p.completedSessions));
  const slot = innerWidth / points.length;
  const barWidth = Math.min(36, slot * 0.6);
  const y = (value) => pad.top + innerHeight - (value / max) * innerHeight;
  const ticks = [0, Math.round(max / 2), max];

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Completed sessions per week, latest week ${points.at(-1)?.completedSessions ?? 0}`}>
        {ticks.map((tick) => (
          <g key={tick}>
            <line className="grid-line" x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} />
            <text x={pad.left - 6} y={y(tick) + 4} textAnchor="end">{tick}</text>
          </g>
        ))}
        {points.map((point, index) => {
          const x = pad.left + slot * index + (slot - barWidth) / 2;
          return (
            <g key={point.weekStart}>
              <rect className="bar" x={x} y={y(point.completedSessions)} width={barWidth} height={Math.max(0, y(0) - y(point.completedSessions))} rx={3}>
                <title>{`Week of ${formatDate(point.weekStart)}: ${point.completedSessions} sessions`}</title>
              </rect>
              {point.completedSessions > 0 && (
                <text x={x + barWidth / 2} y={y(point.completedSessions) - 4} textAnchor="middle">{point.completedSessions}</text>
              )}
              <text x={x + barWidth / 2} y={height - 6} textAnchor="middle">{formatDate(point.weekStart).replace(/,? \d{4}$/, "")}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
