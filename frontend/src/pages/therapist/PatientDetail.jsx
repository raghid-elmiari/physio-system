import { Link, useParams, useSearchParams } from "react-router-dom";
import { therapistApi } from "../../api/services";
import { useApi } from "../../lib/useApi";
import { ageFrom, relativeDay } from "../../lib/format";
import { REHAB_STATUS_LABELS, REHAB_STATUS_TONES } from "../../lib/clinicalLabels";
import { ErrorState, Spinner } from "../../components/ui";
import PatientOverviewPanel from "../../features/patients/PatientOverviewPanel";
import PrescriptionPanel from "../../features/patients/PrescriptionPanel";
import PerformancePanel from "../../features/patients/PerformancePanel";
import ReportsPanel from "../../features/patients/ReportsPanel";

const TABS = [
  ["overview", "Overview"],
  ["program", "Exercise program"],
  ["performance", "Performance"],
  ["reports", "Reports"],
];

export default function PatientDetail() {
  const { patientId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = TABS.some(([key]) => key === searchParams.get("tab")) ? searchParams.get("tab") : "overview";
  const patient = useApi(() => therapistApi.patient(patientId), [patientId]);

  if (patient.loading && !patient.data) return <main className="page"><Spinner /></main>;
  if (patient.error) return <main className="page"><ErrorState message={patient.error} onRetry={patient.reload} /></main>;
  const p = patient.data;
  const age = ageFrom(p.dateOfBirth);

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p><Link to="/patients">← Patients</Link></p>
          <h1>{p.firstName} {p.lastName}</h1>
          <div className="row">
            <span className="badge">#{p.id}</span>
            <span className={`badge ${REHAB_STATUS_TONES[p.rehabStatus] ?? ""}`}>{REHAB_STATUS_LABELS[p.rehabStatus] ?? "Status not set"}</span>
            {p.accountStatus === "DISABLED" && <span className="badge danger">Account deactivated</span>}
            <span className="small muted">
              {p.primaryCondition ? `${p.primaryCondition} · ` : ""}{age != null ? `${age} years · ` : ""}last session {relativeDay(p.lastSessionAt)}
            </span>
          </div>
        </div>
      </div>

      <nav className="tabs" aria-label="Patient sections">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={activeTab === key ? "active" : ""}
            aria-current={activeTab === key ? "page" : undefined}
            onClick={() => setSearchParams({ tab: key }, { replace: true })}
          >
            {label}
          </button>
        ))}
      </nav>

      {activeTab === "overview" && <PatientOverviewPanel patient={p} onPatientChanged={patient.reload} />}
      {activeTab === "program" && <PrescriptionPanel patientId={p.id} onProgramChanged={patient.reload} />}
      {activeTab === "performance" && <PerformancePanel patientId={p.id} />}
      {activeTab === "reports" && <ReportsPanel patientId={p.id} />}
    </main>
  );
}
