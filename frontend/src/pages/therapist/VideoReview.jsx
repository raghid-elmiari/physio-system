import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { errorMessage } from "../../api/client";
import { exercisesApi, therapistApi } from "../../api/services";
import { useAuth } from "../../context/AuthContext";
import { useApi } from "../../lib/useApi";
import { formatDateTime } from "../../lib/format";
import { VIDEO_STATUS_LABELS, VIDEO_STATUS_TONES } from "../../lib/clinicalLabels";
import { ErrorState, Field, Spinner } from "../../components/ui";
import { YouTubeEmbed } from "../../components/clinical";

export default function VideoReview() {
  const { submissionId } = useParams();
  const sub = useApi(() => therapistApi.videoSubmission(submissionId), [submissionId]);
  const exercises = useApi(() => exercisesApi.list(), []);
  const { user } = useAuth();
  const [form, setForm] = useState({ feedback: "", exerciseId: "", addToLibrary: false, instructions: "" });
  const [state, setState] = useState({ busy: false, error: null });

  const s = sub.data;
  if (sub.loading && !s) return <main className="page"><Spinner /></main>;
  if (sub.error) return <main className="page"><ErrorState message={sub.error} onRetry={sub.reload} /></main>;
  const reviewable = s.status === "PENDING" && user?.role === "THERAPIST";

  async function decide(kind) {
    const reason = form.feedback.trim();
    if (kind !== "approve" && !reason) return setState({ busy: false, error: kind === "reject" ? "Give a reason for rejecting." : "Explain what the patient should change." });
    const question = { approve: "Approve this video as learning material for the patient?", reject: "Reject this suggestion?", revision: "Ask the patient to change this suggestion?" }[kind];
    if (!window.confirm(question)) return;
    setState({ busy: true, error: null });
    try {
      if (kind === "approve") {
        await therapistApi.approveVideo(s.id, {
          feedback: reason || null,
          exerciseId: form.exerciseId ? Number(form.exerciseId) : s.exerciseId,
          addToLibrary: form.addToLibrary,
          instructions: form.instructions.trim() || null,
        });
      } else if (kind === "reject") await therapistApi.rejectVideo(s.id, reason);
      else await therapistApi.requestVideoRevision(s.id, reason);
      setState({ busy: false, error: null });
      sub.reload();
    } catch (err) {
      setState({ busy: false, error: errorMessage(err) });
    }
  }

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p><Link to="/therapist/videos">← Video suggestions</Link></p>
          <h1>{s.title || "YouTube video"}</h1>
          <div className="row">
            <span className={`badge ${VIDEO_STATUS_TONES[s.status]}`}>{VIDEO_STATUS_LABELS[s.status]}</span>
            <span className="small muted">Suggested by <Link to={`/patients/${s.patientId}?tab=videos`}>{s.patientName}</Link> · {formatDateTime(s.createdAt)}</span>
          </div>
        </div>
      </div>
      <div className="grid cols-2">
        <section className="card">
          <YouTubeEmbed videoId={s.youtubeVideoId} title={s.title} />
          <dl className="details" style={{ marginTop: 12 }}>
            <dt>Channel</dt><dd>{s.channelName || "Unknown"}</dd>
            <dt>Link</dt><dd><a href={s.url} target="_blank" rel="noopener noreferrer">{s.url}</a></dd>
            <dt>Related exercise</dt><dd>{s.exerciseName || "None selected"}</dd>
            <dt>Description</dt><dd>{s.description || "—"}</dd>
            <dt>Why</dt><dd>{s.reason || "—"}</dd>
          </dl>
        </section>
        <section className="card">
          {reviewable ? (
            <>
              <h2>Your review</h2>
              <div className="alert info small" style={{ marginBottom: 12 }}>
                Approving makes this video learning material only. It does not allow the patient to perform the movement: that needs an approved prescription.
              </div>
              <Field label="Feedback / reason" htmlFor="vr-feedback" help="Required to reject or request changes.">
                <textarea id="vr-feedback" className="input" rows={3} maxLength={1000} value={form.feedback} onChange={(e) => setForm({ ...form, feedback: e.target.value })} />
              </Field>
              <Field label="Link to exercise (when approving)" htmlFor="vr-ex">
                <select id="vr-ex" className="input" value={form.exerciseId} onChange={(e) => setForm({ ...form, exerciseId: e.target.value })}>
                  <option value="">{s.exerciseName ? `Keep: ${s.exerciseName}` : "Not linked"}</option>
                  {(exercises.data || []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </Field>
              <Field label="Instructions for the patient (when approving)" htmlFor="vr-instr">
                <input id="vr-instr" className="input" maxLength={1000} value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} />
              </Field>
              <label className="switch" style={{ marginBottom: 14 }}>
                <input type="checkbox" checked={form.addToLibrary} onChange={(e) => setForm({ ...form, addToLibrary: e.target.checked })} /> Also add to the exercise library
              </label>
              {state.error && <div className="alert error" style={{ marginBottom: 12 }}>{state.error}</div>}
              <div className="row">
                <button type="button" className="btn" disabled={state.busy} onClick={() => decide("approve")}>Approve</button>
                <button type="button" className="btn secondary" disabled={state.busy} onClick={() => decide("revision")}>Request changes</button>
                <button type="button" className="btn ghost danger-text" disabled={state.busy} onClick={() => decide("reject")}>Reject</button>
              </div>
            </>
          ) : (
            <>
              <h2>Review</h2>
              {s.reviewedBy ? <p>{VIDEO_STATUS_LABELS[s.status]} by {s.reviewedBy} on {formatDateTime(s.reviewedAt)}.</p> : <p className="muted">Not reviewed yet.</p>}
              {s.feedback && <div className="feedback-note">{s.feedback}</div>}
              {s.status === "PENDING" && user?.role !== "THERAPIST" && <p className="small muted">Only the patient&apos;s assigned physiotherapist can review it.</p>}
            </>
          )}
          <h3 style={{ marginTop: 16 }}>History</h3>
          <ul className="list">
            {s.history.map((h) => (
              <li key={h.id} className="list-item"><div className="main"><div className="title small">{h.fromStatus ? `${VIDEO_STATUS_LABELS[h.fromStatus]} → ` : "Submitted: "}{VIDEO_STATUS_LABELS[h.toStatus]}</div><div className="sub">{h.actorName} · {formatDateTime(h.createdAt)}{h.feedback ? ` · “${h.feedback}”` : ""}</div></div></li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
