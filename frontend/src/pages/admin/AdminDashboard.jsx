import { Link } from "react-router-dom";
import { adminApi } from "../../api/services";
import { useApi } from "../../lib/useApi";
import { formatDateTime } from "../../lib/format";
import { ROLE_LABELS } from "../../lib/clinicalLabels";
import { ErrorState, Spinner, StatTile } from "../../components/ui";

export default function AdminDashboard() {
  const stats = useApi(() => adminApi.stats(), []);
  const workloads = useApi(() => adminApi.workloads(), []);
  const recent = useApi(() => adminApi.auditLog({ size: 8 }), []);
  const s = stats.data;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Administration</h1>
          <p>Accounts, roles, therapist assignments and activity across the platform.</p>
        </div>
        <div className="row">
          <Link className="btn secondary" to="/admin/assignments">Assign patients</Link>
          <Link className="btn" to="/admin/users?add=1">Create user</Link>
        </div>
      </div>
      {stats.loading && <Spinner />}
      {stats.error && <ErrorState message={stats.error} onRetry={stats.reload} />}
      {s && (
        <div className="stack">
          <div className="grid cols-4">
            {Object.entries(s.usersByRole).map(([role, n]) => <StatTile key={role} label={`${ROLE_LABELS[role]}s`} value={n} />)}
            <StatTile label="Deactivated accounts" value={s.disabledUsers} hint={`${s.activeUsers} active`} />
          </div>
          <div className="grid cols-4">
            <StatTile label="Unassigned patients" value={s.unassignedPatients} hint={s.unassignedPatients ? <Link to="/admin/assignments">Assign now</Link> : "Everyone has a therapist"} />
            <StatTile label="Assessments awaiting review" value={s.assessmentsAwaitingReview} />
            <StatTile label="Prescriptions awaiting approval" value={s.prescriptionsAwaitingApproval} hint={`${s.activePrescriptions} active`} />
            <StatTile label="Video suggestions pending" value={s.videoSuggestionsPending} />
          </div>
          <div className="grid cols-4">
            <StatTile label="Camera sessions" value={s.sessionsLast30Days} hint="Last 30 days" />
            <StatTile label="Performance entries" value={s.performanceEntriesLast30Days} hint="Last 30 days" />
          </div>
        </div>
      )}
      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <section className="card">
          <div className="card-head"><h2>Therapist workload</h2><Link className="small" to="/admin/assignments">Manage</Link></div>
          {workloads.loading && <Spinner />}
          {workloads.error && <ErrorState message={workloads.error} onRetry={workloads.reload} />}
          {workloads.data?.length === 0 && <p className="muted">No therapist accounts yet.</p>}
          <ul className="list">
            {(workloads.data || []).map((t) => (
              <li key={t.id} className="list-item">
                <div className="main">
                  <div className="title">{t.name} {t.status === "DISABLED" && <span className="badge danger">Deactivated</span>}</div>
                  <div className="sub">{t.pendingAssessments} assessments · {t.pendingVideoReviews} videos · {t.prescriptionsAwaitingApproval} prescriptions waiting</div>
                </div>
                <span className="badge primary">{t.patients} patient{t.patients === 1 ? "" : "s"}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="card">
          <div className="card-head"><h2>Recent activity</h2><Link className="small" to="/admin/activity">All activity</Link></div>
          {recent.loading && <Spinner />}
          {recent.error && <ErrorState message={recent.error} onRetry={recent.reload} />}
          <ul className="list">
            {(recent.data?.entries || []).map((e) => (
              <li key={e.id} className="list-item"><div className="main"><div className="title small">{e.summary}</div><div className="sub">{e.actorName} · {formatDateTime(e.createdAt)}</div></div></li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
