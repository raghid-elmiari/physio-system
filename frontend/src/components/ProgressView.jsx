import { Link } from "react-router-dom";
import { formatDate, relativeDay } from "../lib/format";
import ProgressChart from "./ProgressChart";
import { EmptyState, StatTile } from "./ui";

/** Progress dashboard for one patient (used by the patient and by their therapist). */
export default function ProgressView({ data, linkReports = true }) {
  const t = data.totals;
  if (t.completedSessions === 0) {
    return (
      <div className="card">
        <EmptyState icon="📈" title="No completed sessions in this period">Progress appears here after the first completed session.</EmptyState>
      </div>
    );
  }
  return (
    <div className="stack">
      <div className="grid cols-4">
        <StatTile label="Completed sessions" value={t.completedSessions} hint={`${t.sessions - t.completedSessions} interrupted`} />
        <StatTile label="Repetitions" value={t.totalReps} hint={`${t.correctReps} correct`} />
        <StatTile label="Average accuracy" value={t.averageAccuracyPct != null ? `${Math.round(t.averageAccuracyPct)}%` : "—"} />
        <StatTile label="Active time" value={`${t.totalMinutes} min`} hint={`${t.activeDaysStreak}-day streak`} />
      </div>
      <section className="card">
        <h2>Accuracy over time</h2>
        <ProgressChart points={data.timeline} />
      </section>
      <section className="card">
        <h2>By exercise</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Exercise</th><th>Sessions</th><th>Reps</th><th>Best</th><th>Latest</th><th>Last done</th></tr>
            </thead>
            <tbody>
              {data.byExercise.map((e) => (
                <tr key={e.exerciseId}>
                  <td>{linkReports ? <Link to={`/exercises/${e.exerciseId}`}>{e.exerciseName}</Link> : e.exerciseName}</td>
                  <td>{e.completedSessions}</td>
                  <td>{e.totalReps}</td>
                  <td>{e.bestAccuracyPct != null ? `${Math.round(e.bestAccuracyPct)}%` : "—"}</td>
                  <td>{e.latestAccuracyPct != null ? `${Math.round(e.latestAccuracyPct)}%` : "—"}</td>
                  <td title={formatDate(e.lastSessionAt)}>{relativeDay(e.lastSessionAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
