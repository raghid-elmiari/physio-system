import { useState } from "react";
import { Link } from "react-router-dom";
import { errorMessage } from "../../api/client";
import { adminApi } from "../../api/services";
import { useApi } from "../../lib/useApi";
import { EmptyState, ErrorState, Spinner } from "../../components/ui";

export default function Assignments() {
  const workloads = useApi(() => adminApi.workloads(), []);
  const [search, setSearch] = useState("");
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);
  const patients = useApi(() => adminApi.users({ role: "PATIENT", search }), [search]);
  const [message, setMessage] = useState(null);
  const activeTherapists = (workloads.data || []).filter((t) => t.status === "ACTIVE");

  async function assign(patient, therapistIdRaw) {
    const therapistId = therapistIdRaw ? Number(therapistIdRaw) : null;
    if (therapistId === patient.therapistId) return;
    const target = activeTherapists.find((t) => t.id === therapistId);
    const action = therapistId == null ? `Remove ${patient.firstName} ${patient.lastName}'s therapist?` :
      patient.therapistId ? `Reassign ${patient.firstName} ${patient.lastName} from ${patient.therapistName} to ${target?.name}? Pending reviews move to the new therapist.` :
      `Assign ${patient.firstName} ${patient.lastName} to ${target?.name}?`;
    const reason = window.prompt(`${action}\n\nReason (optional):`, "");
    if (reason === null) return patients.reload();
    setMessage(null);
    try {
      await adminApi.assignTherapist(patient.id, therapistId, reason || null);
      setMessage({ tone: "success", text: therapistId ? `${patient.firstName} is now with ${target?.name}.` : `${patient.firstName} is unassigned.` });
      patients.reload();
      workloads.reload();
    } catch (err) {
      setMessage({ tone: "error", text: errorMessage(err) });
      patients.reload();
    }
  }

  const shown = (patients.data || []).filter((p) => !onlyUnassigned || !p.therapistId);
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Therapist assignments</h1>
          <p>Each patient is treated by one physiotherapist, who alone can see their records and make clinical decisions.</p>
        </div>
      </div>
      <div className="stack">
        <section className="card">
          <h2>Workload</h2>
          {workloads.loading && <Spinner />}
          {workloads.error && <ErrorState message={workloads.error} onRetry={workloads.reload} />}
          {workloads.data?.length === 0 && <EmptyState title="No therapists">Create a therapist account in <Link to="/admin/users?add=1">Users</Link>.</EmptyState>}
          {workloads.data?.length > 0 && (
            <div className="table-wrap">
              <table className="table responsive">
                <thead><tr><th>Therapist</th><th>Patients</th><th>Active</th><th>Assessments to review</th><th>Videos to review</th><th>Awaiting approval</th><th>Active prescriptions</th></tr></thead>
                <tbody>
                  {workloads.data.map((t) => (
                    <tr key={t.id}>
                      <td className="primary">{t.name} {t.status === "DISABLED" && <span className="badge danger">Deactivated</span>}</td>
                      <td data-label="Patients">{t.patients}</td>
                      <td data-label="Active">{t.activePatients}</td>
                      <td data-label="Assessments">{t.pendingAssessments}</td>
                      <td data-label="Videos">{t.pendingVideoReviews}</td>
                      <td data-label="Awaiting approval">{t.prescriptionsAwaitingApproval}</td>
                      <td data-label="Active prescriptions">{t.activePrescriptions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        {message && <div className={`alert ${message.tone}`}>{message.text}</div>}
        <section className="card">
          <h2>Patients</h2>
          <div className="filters">
            <input className="input" type="search" placeholder="Search patients" aria-label="Search patients" value={search} onChange={(e) => setSearch(e.target.value)} />
            <label className="switch"><input type="checkbox" checked={onlyUnassigned} onChange={(e) => setOnlyUnassigned(e.target.checked)} /> Only unassigned</label>
          </div>
          {patients.loading && <Spinner />}
          {patients.error && <ErrorState message={patients.error} onRetry={patients.reload} />}
          {patients.data && shown.length === 0 && <EmptyState title="No patients to show" />}
          <ul className="list">
            {shown.map((p) => (
              <li key={p.id} className="list-item">
                <div className="main">
                  <div className="title">{p.firstName} {p.lastName} <span className="muted small">#{p.id}</span> {p.status === "DISABLED" && <span className="badge danger">Deactivated</span>}</div>
                  <div className="sub">{p.email}</div>
                </div>
                <label className="inline-field" style={{ minWidth: 200 }}>Physiotherapist
                  <select className="input" value={p.therapistId ?? ""} onChange={(e) => assign(p, e.target.value)} aria-label={`Physiotherapist for ${p.firstName} ${p.lastName}`}>
                    <option value="">Unassigned</option>
                    {activeTherapists.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.patients})</option>)}
                  </select>
                </label>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
