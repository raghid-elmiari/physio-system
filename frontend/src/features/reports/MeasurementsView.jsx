import { Link } from "react-router-dom";
import ProgressChart from "../../components/ProgressChart";
import { AccuracyBadge, StatTile, StatusBadge } from "../../components/ui";
import { formatCalendarDate, formatDateTime, formatDuration } from "../../lib/format";
import {
  DIFFICULTY_LABELS,
  PRESCRIPTION_STATUS_LABELS,
  PRESCRIPTION_STATUS_TONES,
  describeDose,
  formatMetric,
  formatPercent,
  metricLabel,
} from "../../lib/clinicalLabels";

/**
 * System-generated performance figures for one patient and period (ReportDtos.PatientMeasurements).
 * Used live on the patient's Performance tab and frozen inside stored reports.
 */
export default function MeasurementsView({ measurements, linkSessions = true }) {
  const { totals, prescriptions, exercises, previousPeriod, sessions, automatedFindings } = measurements;
  const chartPoints = sessions
    .filter((s) => s.accuracyPct != null)
    .map((s) => ({ sessionId: s.sessionId, date: s.startedAt, accuracyPct: s.accuracyPct, exerciseName: s.exerciseName }));

  return (
    <div className="stack">
      <div className="grid cols-4">
        <StatTile label="Completed sessions" value={totals.completedSessions} hint={`${totals.interruptedSessions} interrupted`} />
        <StatTile
          label="Prescribed sessions done"
          value={formatPercent(totals.completionPct)}
          hint={totals.expectedSessions ? `${totals.missedSessions} missed of ~${totals.expectedSessions}` : "No weekly target set"}
        />
        <StatTile label="Repetitions" value={totals.totalReps} hint={`${totals.correctReps} without a detected error`} />
        <StatTile label="Average accuracy" value={formatPercent(totals.averageAccuracyPct)} hint={`${formatDuration(totals.totalDurationSeconds)} exercising`} />
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Accuracy per session</h2>
          <span className="small muted">
            {previousPeriod.completedSessions
              ? `Previous period: ${formatPercent(previousPeriod.averageAccuracyPct)} over ${previousPeriod.completedSessions} sessions`
              : "No sessions in the previous period"}
          </span>
        </div>
        <ProgressChart points={chartPoints} height={190} emptyMessage="At least two completed sessions are needed to draw a trend." />
      </section>

      <section className="card">
        <h2>Prescriptions in this period</h2>
        {prescriptions.length === 0 ? (
          <p className="muted">No prescription was in force during this period.</p>
        ) : (
          <div className="table-wrap">
            <table className="table responsive">
              <thead>
                <tr><th>Exercise</th><th>Dose</th><th>Difficulty</th><th>Status</th><th>Sessions done</th></tr>
              </thead>
              <tbody>
                {prescriptions.map((p) => (
                  <tr key={p.assignmentId}>
                    <td className="primary">{p.exerciseName}</td>
                    <td data-label="Dose">{describeDose(p)}</td>
                    <td data-label="Difficulty">{DIFFICULTY_LABELS[p.difficulty] ?? "—"}</td>
                    <td data-label="Status"><span className={`badge ${PRESCRIPTION_STATUS_TONES[p.status] ?? ""}`}>{PRESCRIPTION_STATUS_LABELS[p.status] ?? p.status}</span></td>
                    <td data-label="Sessions done">
                      {p.expectedSessions ? `${p.completedSessions} of ~${p.expectedSessions} (${formatPercent(p.completionPct)})` : p.completedSessions}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="small muted" style={{ marginTop: 8 }}>Expected sessions are estimated from each prescription&apos;s weekly frequency over the days it was active.</p>
      </section>

      <section className="card">
        <h2>Performance by exercise</h2>
        {exercises.length === 0 ? (
          <p className="muted">No sessions were recorded in this period.</p>
        ) : (
          <div className="stack">
            {exercises.map((e) => (
              <div key={e.exerciseId} className="card flat">
                <div className="card-head">
                  <h3 style={{ margin: 0 }}>{e.exerciseName}</h3>
                  <AccuracyBadge value={e.averageAccuracyPct} />
                </div>
                <div className="metric-grid">
                  <Metric label="Sessions" value={`${e.completedSessions}${e.interruptedSessions ? ` (+${e.interruptedSessions} interrupted)` : ""}`} />
                  <Metric label="Repetitions (correct)" value={`${e.totalReps} (${e.correctReps})`} />
                  <Metric label="Exercise time" value={formatDuration(e.totalDurationSeconds)} />
                  <Metric label="First → latest accuracy" value={e.firstAccuracyPct != null ? `${formatPercent(e.firstAccuracyPct)} → ${formatPercent(e.latestAccuracyPct)}` : "—"} />
                  <Metric label="Movement errors detected" value={e.movementErrorsDetected} />
                  {Object.entries(e.averageMeasurements || {}).map(([key, value]) => (
                    <Metric key={key} label={`${metricLabel(key)} (avg)`} value={formatMetric(key, value)} />
                  ))}
                </div>
                {e.commonErrors.length > 0 && (
                  <div className="bars" style={{ marginTop: 12 }}>
                    {e.commonErrors.map((error) => (
                      <div key={error.code} className="bar-row">
                        <span>{error.message || error.code}</span>
                        <span className="track"><span className="fill" style={{ width: `${(error.count / e.commonErrors[0].count) * 100}%`, display: "block" }} /></span>
                        <strong>{error.count}×</strong>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        <p className="small muted" style={{ marginTop: 8 }}>
          Measured from camera landmarks on the patient&apos;s device; not clinical measurements. Sets are not tracked by the camera analysis.
        </p>
      </section>

      <section className="card automated-findings" aria-labelledby="findings-h">
        <div className="card-head">
          <h2 id="findings-h">Automated findings</h2>
          <span className="badge">System-generated</span>
        </div>
        <div className="grid cols-2">
          <div>
            <h3>Areas of improvement</h3>
            {automatedFindings.improvements.length ? (
              <ul>{automatedFindings.improvements.map((text) => <li key={text}>{text}</li>)}</ul>
            ) : <p className="muted small">No clear improvement trend in this period.</p>}
          </div>
          <div>
            <h3>Needs further attention</h3>
            {automatedFindings.needsAttention.length ? (
              <ul>{automatedFindings.needsAttention.map((text) => <li key={text}>{text}</li>)}</ul>
            ) : <p className="muted small">No automated flags raised.</p>}
          </div>
        </div>
        <p className="small muted">{automatedFindings.disclaimer}</p>
      </section>

      <section className="card">
        <h2>Session log</h2>
        {sessions.length === 0 ? (
          <p className="muted">No sessions in this period.</p>
        ) : (
          <div className="table-wrap">
            <table className="table responsive">
              <thead>
                <tr><th>Date</th><th>Exercise</th><th>Status</th><th>Reps</th><th>Accuracy</th><th>Duration</th><th>Errors</th></tr>
              </thead>
              <tbody>
                {[...sessions].reverse().map((s) => (
                  <tr key={s.sessionId}>
                    <td className="primary">{formatDateTime(s.startedAt)}</td>
                    <td data-label="Exercise">{s.exerciseName}</td>
                    <td data-label="Status"><StatusBadge status={s.status} /></td>
                    <td data-label="Reps">{s.repsCompleted ?? 0}/{s.repsRequested ?? "—"}{s.correctReps != null ? ` (${s.correctReps} correct)` : ""}</td>
                    <td data-label="Accuracy">
                      {s.status === "COMPLETED" && linkSessions ? <Link to={`/reports/${s.sessionId}`}>{formatPercent(s.accuracyPct)}</Link> : formatPercent(s.accuracyPct)}
                    </td>
                    <td data-label="Duration">{formatDuration(s.durationSeconds)}</td>
                    <td data-label="Errors">{s.movementErrorsDetected}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="metric">
      <div className="k">{label}</div>
      <div className="v">{value}</div>
    </div>
  );
}

export function PeriodLabel({ period }) {
  return <>{formatCalendarDate(period.from)} – {formatCalendarDate(period.to)} ({period.days} days)</>;
}
