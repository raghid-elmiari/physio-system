import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { errorMessage } from "../../api/client";
import { exercisesApi, therapistApi } from "../../api/services";
import { useApi } from "../../lib/useApi";
import { formatDateTime } from "../../lib/format";
import { VIDEO_STATUS_LABELS, VIDEO_STATUS_TONES } from "../../lib/clinicalLabels";
import { extractYouTubeId } from "../../lib/youtube";
import { EmptyState, ErrorState, Field, Spinner } from "../../components/ui";
import { VideoSummary, YouTubeEmbed } from "../../components/clinical";

const TABS = [
  ["PENDING", "New & pending"],
  ["APPROVED", "Approved"],
  ["REJECTED", "Rejected"],
  ["REVISION_REQUESTED", "Revision requested"],
  ["history", "Approval history"],
  ["library", "Video library"],
];

export default function VideoReviews() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some(([k]) => k === params.get("tab")) ? params.get("tab") : "PENDING";
  const all = useApi(() => therapistApi.videoSubmissions(), []);
  const count = (s) => (all.data || []).filter((x) => x.status === s).length;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Video suggestions</h1>
          <p>Review YouTube videos your patients suggest, and manage approved learning videos.</p>
        </div>
      </div>
      <nav className="tabs" aria-label="Video sections">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" className={tab === key ? "active" : ""} aria-current={tab === key ? "page" : undefined}
            onClick={() => setParams({ tab: key }, { replace: true })}>
            {label}{["PENDING", "REVISION_REQUESTED"].includes(key) && count(key) ? ` (${count(key)})` : ""}
          </button>
        ))}
      </nav>
      {tab === "history" ? <History /> : tab === "library" ? <Library /> : (
        <section className="card">
          {all.loading && <Spinner />}
          {all.error && <ErrorState message={all.error} onRetry={all.reload} />}
          {all.data && count(tab) === 0 && <EmptyState icon="🎬" title={`No ${VIDEO_STATUS_LABELS[tab].toLowerCase()} suggestions`} />}
          <ul className="list">
            {(all.data || []).filter((s) => s.status === tab).map((s) => (
              <li key={s.id} className="list-item" style={{ alignItems: "flex-start" }}>
                <div className="main">
                  <VideoSummary videoId={s.youtubeVideoId} title={s.title} channelName={s.channelName}>
                    <div className="sub">{s.patientName} · {formatDateTime(s.createdAt)}{s.exerciseName ? ` · ${s.exerciseName}` : ""}</div>
                    {s.description && <div className="sub">“{s.description}”</div>}
                    {s.feedback && <div className="sub">Feedback: {s.feedback}</div>}
                  </VideoSummary>
                </div>
                <Link className={`btn sm ${s.status === "PENDING" ? "" : "secondary"}`} to={`/therapist/videos/${s.id}`}>{s.status === "PENDING" ? "Review" : "Open"}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

function History() {
  const history = useApi(() => therapistApi.videoHistory(), []);
  return (
    <section className="card">
      {history.loading && <Spinner />}
      {history.error && <ErrorState message={history.error} onRetry={history.reload} />}
      {history.data?.length === 0 && <EmptyState title="No review activity yet" />}
      <ul className="list">
        {(history.data || []).map((h) => (
          <li key={h.id} className="list-item">
            <div className="main">
              <div className="title small"><Link to={`/therapist/videos/${h.submissionId}`}>Suggestion #{h.submissionId}</Link>: {h.fromStatus ? `${VIDEO_STATUS_LABELS[h.fromStatus]} → ` : ""}{VIDEO_STATUS_LABELS[h.toStatus]}</div>
              <div className="sub">{h.actorName} · {formatDateTime(h.createdAt)}{h.feedback ? ` · “${h.feedback}”` : ""}</div>
            </div>
            <span className={`badge ${VIDEO_STATUS_TONES[h.toStatus]}`}>{VIDEO_STATUS_LABELS[h.toStatus]}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Library() {
  const videos = useApi(() => therapistApi.videoLibrary(), []);
  const exercises = useApi(() => exercisesApi.list(), []);
  const [form, setForm] = useState({ url: "", exerciseId: "" });
  const [state, setState] = useState({ busy: false, error: null });
  const [preview, setPreview] = useState(null);
  const id = extractYouTubeId(form.url);

  async function act(fn, reset = false) {
    setState({ busy: true, error: null });
    try {
      await fn();
      if (reset) setForm({ url: "", exerciseId: "" });
      setState({ busy: false, error: null });
      videos.reload();
    } catch (err) {
      setState({ busy: false, error: errorMessage(err) });
    }
  }

  return (
    <div className="stack">
      <form className="card" onSubmit={(e) => { e.preventDefault(); if (id) act(() => therapistApi.addLibraryVideo({ url: form.url.trim(), exerciseId: form.exerciseId ? Number(form.exerciseId) : null }), true); }} noValidate>
        <h2>Add a YouTube video to the library</h2>
        <div className="grid cols-2" style={{ gap: 0, columnGap: 12 }}>
          <Field label="YouTube link" htmlFor="lib-url" help={form.url && !id ? "Not a YouTube video link." : "Demonstration videos are shown with their exercise."}>
            <input id="lib-url" className={`input ${form.url && !id ? "invalid" : ""}`} value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
          </Field>
          <Field label="Exercise" htmlFor="lib-ex">
            <select id="lib-ex" className="input" value={form.exerciseId} onChange={(e) => setForm({ ...form, exerciseId: e.target.value })}>
              <option value="">Not linked</option>
              {(exercises.data || []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </Field>
        </div>
        {state.error && <div className="alert error" style={{ marginBottom: 12 }}>{state.error}</div>}
        <button type="submit" className="btn" disabled={!id || state.busy}>Add to library</button>
      </form>
      <section className="card">
        <h2>Library videos</h2>
        {videos.loading && <Spinner />}
        {videos.error && <ErrorState message={videos.error} onRetry={videos.reload} />}
        {videos.data?.length === 0 && <EmptyState title="No library videos yet" />}
        <ul className="list">
          {(videos.data || []).map((v) => (
            <li key={v.id} className="list-item" style={{ alignItems: "flex-start" }}>
              <div className="main">
                <VideoSummary videoId={v.youtubeVideoId} title={v.title} channelName={v.channelName}>
                  <div className="sub">{v.origin === "PATIENT_SUBMISSION" ? "From a patient suggestion" : "Added by a therapist"}{v.addedBy ? ` · ${v.addedBy}` : ""}</div>
                  <label className="inline-field" style={{ marginTop: 6 }}>Linked exercise
                    <select className="input" value={v.exerciseId ?? ""} onChange={(e) => act(() => therapistApi.linkLibraryVideo(v.id, e.target.value ? Number(e.target.value) : null))}>
                      <option value="">Not linked</option>
                      {(exercises.data || []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                  </label>
                  {preview === v.id && <div style={{ marginTop: 8 }}><YouTubeEmbed videoId={v.youtubeVideoId} title={v.title} /></div>}
                </VideoSummary>
              </div>
              <div className="stack" style={{ gap: 6 }}>
                <button type="button" className="btn secondary sm" onClick={() => setPreview(preview === v.id ? null : v.id)}>{preview === v.id ? "Hide" : "Preview"}</button>
                <button type="button" className="btn ghost sm danger-text" disabled={state.busy}
                  onClick={() => window.confirm("Remove this video from the library? Patients it was shared with will no longer see it.") && act(() => therapistApi.removeLibraryVideo(v.id))}>Remove</button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
