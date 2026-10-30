import { Link, useParams, useSearchParams } from "react-router-dom";
import { exercisesApi, sessionsApi } from "../api/services";
import { useApi } from "../lib/useApi";
import { formatDateTime, sessionAccuracy } from "../lib/format";
import { AccuracyBadge, ErrorState, Spinner, StatusBadge } from "../components/ui";
import { getAnalyzer } from "../core/exercises/registry";
import { useAuth } from "../context/AuthContext";

export default function ExerciseDetail() {
  const { exerciseId } = useParams();
  const [params] = useSearchParams();
  const assignmentId = params.get("assignment");
  const { user } = useAuth();
  const isTherapist = user?.role === "THERAPIST" || user?.role === "ADMIN";
  const exercise = useApi(() => exercisesApi.get(exerciseId), [exerciseId]);
  const history = useApi(() => sessionsApi.history(exerciseId), [exerciseId]);

  if (exercise.loading) return <main className="page"><Spinner /></main>;
  if (exercise.error) return <main className="page"><ErrorState message={exercise.error} onRetry={exercise.reload} /></main>;

  const e = exercise.data;
  const analyzer = getAnalyzer(e.analyzerKey);
  const steps = (e.instructions || "").split("\n").map((s) => s.trim()).filter(Boolean);
  const startUrl = `/session/live/${e.id}${assignmentId ? `?assignment=${assignmentId}` : ""}`;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p><Link to="/exercises">← Exercises</Link></p>
          <h1>{e.name}</h1>
          <div className="row">
            {e.bodyRegion && <span className="badge">{e.bodyRegion}</span>}
            <span className="badge">{e.defaultReps} reps default</span>
            {analyzer ? <span className="badge primary">Camera coach</span> : <span className="badge">No camera analysis yet</span>}
          </div>
        </div>
        <div className="row">
          {isTherapist && e.analyzerKey === "reference_dtw" && (
            <Link className="btn secondary" to={`/therapist/exercises/${e.id}/reference`}>Replace reference video</Link>
          )}
          {analyzer && <Link className="btn lg" to={startUrl}>Start session</Link>}
        </div>
      </div>

      <div className="grid cols-2">
        <section className="card">
          <h2>How to do it</h2>
          {e.description && <p className="muted">{e.description}</p>}
          {steps.length > 0 ? (
            <ol className="steps">{steps.map((s) => <li key={s}>{s}</li>)}</ol>
          ) : (
            <p className="muted">No instructions provided.</p>
          )}
        </section>
        <section className="card">
          <h2>Camera setup</h2>
          <p>{e.cameraSetup || "Place your device so your whole body is visible."}</p>
          {analyzer && (
            <>
              <h3>What the coach checks</h3>
              <ul className="small">
                {(analyzer.checksFor ? analyzer.checksFor(e.analysisConfig) : Object.values(analyzer.ERROR_CATALOG).map((c) => c.message)).map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
              <p className="small muted">
                Analysis runs on your device; video is never uploaded. Thresholds are an initial configuration and should be confirmed by your physiotherapist.
              </p>
            </>
          )}
        </section>
      </div>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>Your sessions</h2>
        {history.loading && <Spinner />}
        {history.error && <ErrorState message={history.error} onRetry={history.reload} />}
        {history.data?.length === 0 && <p className="muted">You have not done this exercise yet.</p>}
        <ul className="list">
          {(history.data || []).slice(0, 10).map((s) => (
            <li key={s.id} className="list-item">
              <div className="main">
                <div className="title">{formatDateTime(s.startedAt)}</div>
                <div className="sub">{s.roundsCompleted}/{s.roundsRequested} reps</div>
              </div>
              {s.status === "COMPLETED" ? <Link to={`/reports/${s.id}`}><AccuracyBadge value={sessionAccuracy(s)} /></Link> : <StatusBadge status={s.status} />}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
