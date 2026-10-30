import { Link } from "react-router-dom";
import { DIFFICULTY_LABELS } from "../lib/clinicalLabels";
import { formatCalendarDate, toIsoDate } from "../lib/format";

/** Card for an exercise, optionally as part of a therapist assignment. */
export default function ExerciseCard({ exercise, assignment }) {
  const reps = assignment?.targetReps ?? exercise.defaultReps;
  const weekly = assignment?.sessionsPerWeek;
  const done = assignment?.completedSessionsLast7Days ?? 0;
  const startUrl = `/session/live/${exercise.id}${assignment ? `?assignment=${assignment.id}` : ""}`;
  const startsLater = assignment?.startDate && assignment.startDate > toIsoDate(new Date());

  return (
    <div className="card exercise-card">
      <div className="row">
        <h3 style={{ margin: 0 }}>{exercise.name}</h3>
        <span className="spacer" />
        {exercise.cameraMonitoringSupported ? <span className="badge primary">Camera coach</span> : <span className="badge">No camera analysis yet</span>}
      </div>
      <div className="meta">
        {exercise.bodyRegion && <span className="badge">{exercise.bodyRegion}</span>}
        <span className="badge">{reps} reps{assignment?.setsPerSession > 1 ? ` × ${assignment.setsPerSession} sets` : ""}</span>
        {assignment?.durationSeconds ? <span className="badge">{assignment.durationSeconds} s hold</span> : null}
        {assignment?.restSeconds ? <span className="badge">{assignment.restSeconds} s rest</span> : null}
        {assignment?.difficulty && <span className="badge">{DIFFICULTY_LABELS[assignment.difficulty]}</span>}
        {weekly && <span className={`badge ${done >= weekly ? "success" : ""}`}>{done}/{weekly} this week</span>}
      </div>
      {(assignment?.startDate || assignment?.endDate) && (
        <p className="small muted">
          {startsLater ? `Starts ${formatCalendarDate(assignment.startDate)}` : assignment.startDate ? `Since ${formatCalendarDate(assignment.startDate)}` : ""}
          {assignment.endDate ? ` · until ${formatCalendarDate(assignment.endDate)}` : ""}
        </p>
      )}
      {exercise.description && <p>{exercise.description}</p>}
      {assignment?.notes && <p className="small"><strong>Your physiotherapist&apos;s instructions:</strong> {assignment.notes}</p>}
      <div className="actions">
        {exercise.cameraMonitoringSupported && (
          <Link className="btn" to={startUrl}>
            Start session
          </Link>
        )}
        <Link className="btn secondary" to={`/exercises/${exercise.id}${assignment ? `?assignment=${assignment.id}` : ""}`}>
          Details
        </Link>
      </div>
    </div>
  );
}
