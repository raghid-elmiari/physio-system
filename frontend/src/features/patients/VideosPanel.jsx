import { useState } from "react";
import { Link } from "react-router-dom";
import { errorMessage } from "../../api/client";
import { therapistApi } from "../../api/services";
import { useApi } from "../../lib/useApi";
import { formatDateTime } from "../../lib/format";
import { VIDEO_STATUS_LABELS, VIDEO_STATUS_TONES } from "../../lib/clinicalLabels";
import { EmptyState, ErrorState, Field, Spinner } from "../../components/ui";
import { VideoSummary } from "../../components/clinical";

/** Videos shared with the patient (add from the library, remove) and their suggestions. */
export default function VideosPanel({ patientId, canDecide }) {
  const resources = useApi(() => therapistApi.videoResources(patientId), [patientId]);
  const library = useApi(() => therapistApi.videoLibrary(), []);
  const submissions = useApi(() => therapistApi.videoSubmissions(), []);
  const [form, setForm] = useState({ videoId: "", instructions: "" });
  const [state, setState] = useState({ busy: false, error: null });
  const mine = (submissions.data || []).filter((s) => s.patientId === patientId);
  const shared = new Set((resources.data || []).map((r) => r.video.id));

  async function act(fn) {
    setState({ busy: true, error: null });
    try {
      await fn();
      resources.reload();
      setForm({ videoId: "", instructions: "" });
      setState({ busy: false, error: null });
    } catch (err) {
      setState({ busy: false, error: errorMessage(err) });
    }
  }

  return (
    <div className="stack">
      <section className="card">
        <h2>Videos shared with the patient</h2>
        <p className="small muted">Sharing a video gives learning material only. It does not approve the movement; prescriptions do.</p>
        {resources.loading && <Spinner />}
        {resources.error && <ErrorState message={resources.error} onRetry={resources.reload} />}
        {resources.data?.length === 0 && <EmptyState icon="🎬" title="No videos shared yet" />}
        <ul className="list">
          {(resources.data || []).map((r) => (
            <li key={r.id} className="list-item">
              <div className="main">
                <VideoSummary videoId={r.video.youtubeVideoId} title={r.video.title} channelName={r.video.channelName}>
                  <div className="sub">{r.video.exerciseName ? `${r.video.exerciseName} · ` : ""}shared {formatDateTime(r.createdAt)}{r.assignedBy ? ` by ${r.assignedBy}` : ""}</div>
                  {r.instructions && <div className="sub">“{r.instructions}”</div>}
                </VideoSummary>
              </div>
              {canDecide && (
                <button type="button" className="btn ghost sm danger-text" disabled={state.busy}
                  onClick={() => window.confirm("Remove this video from the patient's resources?") && act(() => therapistApi.removeVideoResource(r.id))}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
        {canDecide && (
          <div className="confirm-box" style={{ marginTop: 12 }}>
            <Field label="Share a library video" htmlFor="vp-video">
              <select id="vp-video" className="input" value={form.videoId} onChange={(e) => setForm({ ...form, videoId: e.target.value })}>
                <option value="">Choose a video…</option>
                {(library.data || []).filter((v) => !shared.has(v.id)).map((v) => <option key={v.id} value={v.id}>{v.title || v.youtubeVideoId}{v.exerciseName ? ` (${v.exerciseName})` : ""}</option>)}
              </select>
            </Field>
            <Field label="Instructions for the patient (optional)" htmlFor="vp-instr">
              <input id="vp-instr" className="input" maxLength={1000} value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} />
            </Field>
            {state.error && <div className="alert error small" style={{ marginBottom: 8 }}>{state.error}</div>}
            <div className="row">
              <button type="button" className="btn sm" disabled={!form.videoId || state.busy}
                onClick={() => act(() => therapistApi.assignVideoResource(patientId, { videoId: Number(form.videoId), instructions: form.instructions.trim() || null }))}>
                Share video
              </button>
              <Link className="small" to="/therapist/videos?tab=library">Manage the video library</Link>
            </div>
          </div>
        )}
      </section>
      <section className="card">
        <h2>Patient&apos;s suggestions</h2>
        {submissions.loading && <Spinner />}
        {mine.length === 0 && submissions.data && <p className="muted small">The patient has not suggested any videos.</p>}
        <ul className="list">
          {mine.map((s) => (
            <li key={s.id} className="list-item">
              <div className="main"><Link to={`/therapist/videos/${s.id}`}>{s.title || s.youtubeVideoId}</Link><div className="sub">{formatDateTime(s.createdAt)}</div></div>
              <span className={`badge ${VIDEO_STATUS_TONES[s.status]}`}>{VIDEO_STATUS_LABELS[s.status]}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
