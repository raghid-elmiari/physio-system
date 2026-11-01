import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { isNetworkError } from "../api/client";
import { exercisesApi } from "../api/services";
import { useApi } from "../lib/useApi";
import { formatClock, formatDuration } from "../lib/format";
import { storage } from "../platform/storage";
import { ErrorState, Spinner } from "../components/ui";
import VoiceSettingsPanel from "../features/monitoring/VoiceSettingsPanel";
import { useExerciseSession } from "../features/monitoring/useExerciseSession";
import { useAuth } from "../context/AuthContext";

// Phase strip shown during the exercise; each analyzer names its own phases (SETUP is not shown).
const phasesOf = (analyzer) => Object.keys(analyzer?.PHASE_LABELS || {}).filter((p) => p !== "SETUP");
const cacheKey = (id) => `physio.exercise.${id}`;

/** Exercise details are cached so a session can still run when the backend is unreachable. */
async function loadExercise(id, assignmentId) {
  let exercise;
  try {
    exercise = await exercisesApi.get(id);
    storage.setItem(cacheKey(id), JSON.stringify(exercise));
  } catch (err) {
    const cached = storage.getItem(cacheKey(id));
    if (!isNetworkError(err) || !cached) throw err;
    exercise = { ...JSON.parse(cached), fromCache: true };
  }
  let assignment = null;
  if (assignmentId) {
    const key = `physio.assignment.${assignmentId}`;
    try {
      assignment = (await exercisesApi.myAssignments()).find((a) => String(a.id) === String(assignmentId)) || null;
      if (assignment) storage.setItem(key, JSON.stringify(assignment));
    } catch {
      try {
        assignment = JSON.parse(storage.getItem(key) || "null"); // offline: last known prescription
      } catch {
        assignment = null;
      }
    }
  }
  return { exercise, assignment };
}

export default function LiveSession() {
  const { exerciseId } = useParams();
  const [params] = useSearchParams();
  const assignmentId = params.get("assignment");
  const loaded = useApi(() => loadExercise(exerciseId, assignmentId), [exerciseId, assignmentId]);
  const { user } = useAuth();

  if (loaded.loading) return <main className="page"><Spinner label="Loading exercise…" /></main>;
  if (loaded.error) return <main className="page"><ErrorState message={loaded.error} onRetry={loaded.reload} /></main>;
  if (!loaded.data.exercise.cameraMonitoringSupported) {
    return (
      <main className="page">
        <div className="alert info">Camera analysis is not available for “{loaded.data.exercise.name}” yet. <Link to="/exercises">Back to exercises</Link></div>
      </main>
    );
  }
  // Clinical safety: a patient may only perform a prescription their physiotherapist approved.
  // The backend enforces the same rule when the session is registered.
  const rx = loaded.data.assignment;
  if (user?.role === "PATIENT" && (!rx || !rx.startable)) {
    return (
      <main className="page narrow">
        <div className="alert warning">
          {rx ? rx.startBlockedReason : "This exercise is not in your approved program."}{" "}
          <Link to="/dashboard">Back to your program</Link>
        </div>
      </main>
    );
  }
  return <LiveSessionView exercise={loaded.data.exercise} assignment={rx} />;
}

function LiveSessionView({ exercise, assignment }) {
  const targetReps = assignment?.targetReps ?? exercise.defaultReps ?? 10;
  const { videoRef, canvasRef, ...s } = useExerciseSession({ exercise, assignment, targetReps });
  const fileRef = useRef(null);
  const [showDebug, setShowDebug] = useState(false);
  const ev = s.evaluation;
  const latest = s.captions[0];
  const [expiredId, setExpiredId] = useState(null);

  // Show the newest coach message on the video for a few seconds.
  useEffect(() => {
    if (!latest) return undefined;
    const timer = setTimeout(() => setExpiredId(latest.id), 4000);
    return () => clearTimeout(timer);
  }, [latest]);
  const bubble = latest && latest.id !== expiredId ? latest : null;

  const steps = (exercise.instructions || "").split("\n").map((x) => x.trim()).filter(Boolean);
  const running = s.status === "running" || s.status === "paused";
  const reps = ev?.repCount ?? 0;
  const statusChip = !ev
    ? { cls: "", text: "Waiting" }
    : !ev.trackable
      ? { cls: "warn", text: "Can't see you clearly" }
      : ev.status === "INCORRECT"
        ? { cls: "bad", text: "Adjust your form" }
        : { cls: "ok", text: ev.phase === "SETUP" ? "Get into position" : "Good form" };

  if (s.status === "finished") return <FinishedView s={s} exercise={exercise} targetReps={targetReps} />;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p><Link to={`/exercises/${exercise.id}`}>← {exercise.name}</Link></p>
          <h1>{exercise.name}</h1>
          <p>
            Target {targetReps} repetitions{assignment ? " (assigned by your therapist)" : ""}
            {exercise.fromCache ? " · offline copy of the exercise" : ""}
          </p>
        </div>
        <div className="stat" style={{ textAlign: "right" }}>
          <span className="label">Time</span>
          <span className="value">{formatClock(s.elapsedSeconds)}</span>
        </div>
      </div>

      <div className="live-layout">
        <div className="stack">
          <div className={`stage ${s.inputMode === "camera" ? "mirrored" : ""}`}>
            <video ref={videoRef} playsInline muted style={{ display: s.inputMode === "simulation" ? "none" : "block" }} />
            <canvas ref={canvasRef} />
            {(s.status === "idle" || s.status === "error") && (
              <div className="placeholder">
                <div>
                  <p style={{ fontSize: "1.1rem", fontWeight: 600 }}>Camera preview</p>
                  <p className="small">{exercise.cameraSetup || "Make sure your whole upper body is visible."}</p>
                </div>
              </div>
            )}
            {s.status === "preparing" && (
              <div className="placeholder"><div><span className="spinner" /> <p>Starting camera and loading the pose model…</p></div></div>
            )}
            {(running || s.status === "ready") && (
              <div className="hud">
                <span className="hud-chip"><span className={`status-dot ${statusChip.cls}`} />{statusChip.text}</span>
                <span className="hud-chip hud-reps" aria-live="polite">{reps}/{targetReps}</span>
              </div>
            )}
            {bubble && running && <div className={`coach-bubble ${bubble.kind}`} aria-live="assertive">{bubble.text}</div>}
          </div>

          {s.error && <ErrorState message={s.error} />}
          {s.sessionInfo.online === false && running && (
            <div className="alert warning">The server is unreachable. Monitoring continues on this device and the session will be uploaded when you are back online.</div>
          )}

          <div className="controls-bar">
            {(s.status === "idle" || s.status === "error") && (
              <button type="button" className="btn lg" onClick={() => s.prepare({ mode: "camera" })}>Enable camera</button>
            )}
            {s.status === "ready" && <button type="button" className="btn lg" onClick={s.start}>Start exercise</button>}
            {s.status === "running" && <button type="button" className="btn lg secondary" onClick={s.pause}>Pause</button>}
            {s.status === "paused" && <button type="button" className="btn lg" onClick={s.resume}>Resume</button>}
            {running && <button type="button" className="btn lg" onClick={s.finish}>Finish &amp; save</button>}
            {(running || s.status === "ready") && <button type="button" className="btn lg ghost" onClick={s.cancel}>Cancel</button>}
            {s.status === "saving" && <button type="button" className="btn lg" disabled>Saving…</button>}
          </div>
          {ev?.repCount >= targetReps && running && <div className="alert success">Set complete. Press “Finish &amp; save” to record your session.</div>}

          {(s.status === "idle" || s.status === "error") && (
            <details className="panel card flat">
              <summary>No camera? Other input options</summary>
              <div className="row">
                <button type="button" className="btn secondary" onClick={() => fileRef.current?.click()}>Use a recorded video</button>
                <input ref={fileRef} type="file" accept="video/*" hidden onChange={(e) => e.target.files?.[0] && s.prepare({ mode: "file", file: e.target.files[0] })} />
                <button type="button" className="btn secondary" onClick={() => s.prepare({ mode: "simulation" })}>Run simulated demo</button>
              </div>
              <p className="small muted" style={{ marginTop: 8 }}>
                A recorded video is analysed locally and never uploaded. The simulated demo replays scripted landmark data (not a real person) to show how the coach responds.
              </p>
            </details>
          )}
        </div>

        <aside className="stack">
          <section className="card">
            <div className="card-head">
              <h2>Progress</h2>
              <span className="muted small">{ev?.correctReps ?? 0} correct</span>
            </div>
            <div className="progress-bar" aria-label="Repetitions completed"><span style={{ width: `${Math.min(100, (reps / targetReps) * 100)}%` }} /></div>
            <div className="phase-track" style={{ marginTop: 12 }} aria-label="Movement phase">
              {phasesOf(s.analyzer).map((p) => <span key={p} className={ev?.phase === p ? "on" : ""}>{s.analyzer.PHASE_LABELS[p]}</span>)}
            </div>
            <p className="small muted" style={{ marginTop: 8 }}>{ev ? ev.phaseLabel : "Not started"}</p>
            {ev?.activeErrors?.length > 0 && (
              <ul className="small" style={{ color: "var(--danger)", paddingLeft: 18, margin: 0 }}>
                {ev.activeErrors.map((e) => <li key={e.code}>{e.message}</li>)}
              </ul>
            )}
            {ev && (
              <div style={{ marginTop: 10 }}>
                <div className="row small"><span className="spacer">Tracking quality</span><strong>{Math.round((ev.trackingQuality || 0) * 100)}%</strong></div>
                <div className="progress-bar"><span style={{ width: `${Math.round((ev.trackingQuality || 0) * 100)}%`, background: ev.trackable ? "var(--success)" : "var(--warning)" }} /></div>
              </div>
            )}
          </section>

          <section className="card">
            <h2>Instructions</h2>
            <ol className="steps small">{steps.map((x) => <li key={x}>{x}</li>)}</ol>
          </section>

          <VoiceSettingsPanel s={s} />

          <section className="card">
            <div className="card-head">
              <h2>Coach log</h2>
              <button type="button" className="btn ghost sm" onClick={() => setShowDebug((v) => !v)}>{showDebug ? "Hide" : "Show"} metrics</button>
            </div>
            {s.captions.length === 0 ? <p className="muted small">Spoken feedback will also appear here.</p> : (
              <ul className="caption-log">{s.captions.map((c) => <li key={c.id} className={c.kind}>{c.text}</li>)}</ul>
            )}
            {showDebug && (
              <div className="metric-grid" style={{ marginTop: 12 }}>
                {ev?.metrics?.display ? (
                  // Analyzers with their own measurements (e.g. reference matching) describe them.
                  ev.metrics.display.map((m) => <Metric key={m.label} k={m.label} v={m.value} />)
                ) : (
                  <>
                    <Metric k="Left arm" v={fmtDeg(ev?.metrics?.leftAbductionDeg)} />
                    <Metric k="Right arm" v={fmtDeg(ev?.metrics?.rightAbductionDeg)} />
                    <Metric k="Left elbow" v={fmtDeg(ev?.metrics?.leftElbowDeg)} />
                    <Metric k="Right elbow" v={fmtDeg(ev?.metrics?.rightElbowDeg)} />
                    <Metric k="Trunk lean" v={fmtDeg(ev?.metrics?.trunkLeanDeg)} />
                  </>
                )}
                <Metric k="Speed" v={ev?.metrics ? `${Math.round(ev.metrics.angularSpeedDegPerSec)}°/s` : "—"} />
                <Metric k="Processed FPS" v={s.perf ? `${s.perf.processedFps} / ${s.perf.targetFps}` : "—"} />
                <Metric k="Inference" v={s.perf?.inferenceMs != null ? `${s.perf.inferenceMs} ms` : "—"} />
                <Metric k="Model" v={s.modelInfo ? `${s.modelInfo.variant} · ${s.modelInfo.delegate}` : "—"} />
                <Metric k="Server" v={s.sessionInfo.online == null ? "—" : s.sessionInfo.online ? `session #${s.sessionInfo.sessionId}` : "offline"} />
              </div>
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}

function Metric({ k, v }) {
  return (
    <div className="metric">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
    </div>
  );
}

const fmtDeg = (x) => (x == null ? "—" : `${Math.round(x)}°`);

function FinishedView({ s, exercise, targetReps }) {
  const r = s.result;
  const summary = r?.summary;
  return (
    <main className="page narrow">
      <div className="card stack">
        <h1>Session finished</h1>
        {r?.saved === "server" && <div className="alert success">Saved to your history.</div>}
        {r?.saved === "queued" && <div className="alert warning">You are offline. The session is stored on this device and will upload automatically when the connection returns.</div>}
        {r?.saved === "failed" && <div className="alert error">Could not save: {r.message}</div>}
        <div className="grid cols-2">
          <div className="stat"><span className="label">Repetitions</span><span className="value">{summary?.roundsCompleted ?? 0}/{targetReps}</span></div>
          <div className="stat"><span className="label">Performed correctly</span><span className="value">{summary?.correctReps ?? 0}</span></div>
          <div className="stat"><span className="label">Duration</span><span className="value">{formatDuration(summary?.durationSeconds)}</span></div>
          <div className="stat"><span className="label">Accuracy</span><span className="value">{r?.report ? `${Math.round(Number(r.report.accuracyPct))}%` : summary?.roundsCompleted ? `${Math.round((100 * summary.correctReps) / summary.roundsCompleted)}%` : "—"}</span></div>
        </div>
        {s.voiceStats && s.voiceStats.latencyMs.samples > 0 && (
          <p className="small muted">Voice coach on this device: {s.voiceStats.spoken} messages spoken. Detection to speech {s.voiceStats.latencyMs.mean} ms on average (p95 {s.voiceStats.latencyMs.p95} ms, includes waiting for the previous sentence to finish); speech engine start {s.voiceStats.engineLatencyMs.mean} ms on average.</p>
        )}
        <div className="row">
          {r?.report && <Link className="btn" to={`/reports/${r.report.sessionId}`}>View full report</Link>}
          <Link className="btn secondary" to={`/exercises/${exercise.id}`}>Back to exercise</Link>
          <Link className="btn ghost" to="/dashboard">Home</Link>
        </div>
      </div>
    </main>
  );
}
