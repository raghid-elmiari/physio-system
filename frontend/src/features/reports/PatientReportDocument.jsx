import { ageFrom, formatCalendarDate, formatDateTime } from "../../lib/format";
import MeasurementsView, { PeriodLabel } from "./MeasurementsView";

const ASSESSMENT_SECTIONS = [
  ["observations", "Observations"],
  ["recommendations", "Recommendations"],
  ["exerciseModifications", "Exercise modifications"],
  ["followUpInstructions", "Follow-up instructions"],
];

/**
 * A stored patient report: patient details, the frozen system-generated measurements and
 * the physiotherapist's assessment. `assessmentEditor`, when given, replaces the read-only
 * assessment (the physiotherapist's editing form).
 */
export default function PatientReportDocument({ report, assessmentEditor, linkSessions = false }) {
  const { patient, period } = report.measurements;
  const age = ageFrom(patient.dateOfBirth);

  return (
    <article className="stack report-document">
      <section className="card">
        <div className="card-head">
          <h2>Patient information</h2>
          <span className="small muted">Report generated {formatDateTime(report.createdAt)}{report.authorName ? ` by ${report.authorName}` : ""}</span>
        </div>
        <div className="metric-grid">
          <Detail label="Patient" value={patient.name} />
          <Detail label="Patient ID" value={`#${patient.id}`} />
          <Detail label="Date of birth" value={patient.dateOfBirth ? `${formatCalendarDate(patient.dateOfBirth)}${age != null ? ` (${age})` : ""}` : "Not recorded"} />
          <Detail label="Condition" value={patient.primaryCondition || "Not recorded"} />
          <Detail label="Rehabilitation period" value={<PeriodLabel period={period} />} />
        </div>
      </section>

      <MeasurementsView measurements={report.measurements} linkSessions={linkSessions} />

      <section className="card professional-assessment" aria-labelledby="assessment-h">
        <div className="card-head">
          <h2 id="assessment-h">Physiotherapist&apos;s assessment</h2>
          <span className="badge primary">Professional opinion</span>
        </div>
        {assessmentEditor ?? (
          <div className="stack">
            {ASSESSMENT_SECTIONS.map(([key, label]) => (
              <div key={key}>
                <h3>{label}</h3>
                <p className={report.assessment[key] ? "preserve-lines" : "muted"}>{report.assessment[key] || "Not provided."}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </article>
  );
}

export { ASSESSMENT_SECTIONS };

function Detail({ label, value }) {
  return (
    <div className="metric">
      <div className="k">{label}</div>
      <div className="v" style={{ fontSize: "1rem" }}>{value}</div>
    </div>
  );
}
