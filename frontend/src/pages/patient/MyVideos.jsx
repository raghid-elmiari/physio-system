import { useState } from "react";
import { errorMessage } from "../../api/client";
import { exercisesApi, patientApi } from "../../api/services";
import { useApi } from "../../lib/useApi";
import { formatDateTime } from "../../lib/format";
import { VIDEO_STATUS_LABELS, VIDEO_STATUS_TONES } from "../../lib/clinicalLabels";
import { extractYouTubeId } from "../../lib/youtube";
import { EmptyState, ErrorState, Field, Spinner } from "../../components/ui";
import { VideoSummary, YouTubeEmbed } from "../../components/clinical";

const FILTERS = [
  ["ALL", "My suggestions"],
  ["PENDING", "Pending approval"],
  ["APPROVED", "Approved"],
  ["REJECTED", "Rejected"],
  ["REVISION_REQUESTED", "Revision requested"],
];

export default function MyVideos() {
  const library = useApi(() => patientApi.videos(), []);
  const submissions = useApi(() => patientApi.videoSubmissions(), []);
  const exercises = useApi(() => exercisesApi.list(), []);
  const [filter, setFilter] = useState("ALL");
  const [editing, setEditing] = useState(null); // submission being resubmitted

  const refresh = () => {
    submissions.reload();
    library.reload();
  };
  const shown = (submissions.data || []).filter((s) => filter === "ALL" || s.status === filter);
  const count = (status) => (submissions.data || []).filter((s) => s.status === status).length;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Videos</h1>
          <p>Learning material approved by your physiotherapist, and YouTube videos you suggested.</p>
        </div>
      </div>
      <div className="stack">
        <section className="card" aria-labelledby="approved-h">
          <h2 id="approved-h">Approved videos</h2>
          <p className="small muted">Watching a video does not mean you should do the exercise. Only do exercises that are approved in your program, using your physiotherapist&apos;s targets.</p>
          {library.loading && <Spinner />}
          {library.error && <ErrorState message={library.error} onRetry={library.reload} />}
          {library.data && library.data.resources.length + library.data.programDemonstrations.length === 0 && (
            <EmptyState icon="🎬" title="No videos yet">Your physiotherapist can share videos with you, or approve ones you suggest below.</EmptyState>
          )}
          <div className="video-grid">
            {(library.data?.resources || []).map((r) => (
              <article key={r.id} className="stack" style={{ gap: 8 }}>
                <YouTubeEmbed videoId={r.video.youtubeVideoId} title={r.video.title} />
                <div><strong>{r.video.title || "YouTube video"}</strong>{r.video.exerciseName && <span className="badge" style={{ marginLeft: 6 }}>{r.video.exerciseName}</span>}</div>
                {r.instructions && <p className="small" style={{ margin: 0 }}><strong>From your physiotherapist:</strong> {r.instructions}</p>}
              </article>
            ))}
            {(library.data?.programDemonstrations || []).map((v) => (
              <article key={`demo-${v.id}`} className="stack" style={{ gap: 8 }}>
                <YouTubeEmbed videoId={v.youtubeVideoId} title={v.title} />
                <div><strong>{v.title || "YouTube video"}</strong> <span className="badge primary">Demo: {v.exerciseName}</span></div>
              </article>
            ))}
          </div>
        </section>

        {editing ? (
          <SuggestForm key={editing.id} exercises={exercises.data || []} existing={editing} onDone={() => { setEditing(null); refresh(); }} onCancel={() => setEditing(null)} />
        ) : (
          <SuggestForm exercises={exercises.data || []} onDone={refresh} />
        )}

        <section className="card" aria-labelledby="mine-h">
          <div className="card-head"><h2 id="mine-h">My suggestions</h2></div>
          <div className="segmented" role="group" aria-label="Filter suggestions" style={{ marginBottom: 12 }}>
            {FILTERS.map(([key, label]) => (
              <button key={key} type="button" className={filter === key ? "active" : ""} onClick={() => setFilter(key)}>
                {label}{key !== "ALL" && count(key) ? ` (${count(key)})` : ""}
              </button>
            ))}
          </div>
          {submissions.loading && <Spinner />}
          {submissions.error && <ErrorState message={submissions.error} onRetry={submissions.reload} />}
          {submissions.data && shown.length === 0 && <EmptyState icon="💡" title="Nothing here">Suggest a video above.</EmptyState>}
          <ul className="list">
            {shown.map((s) => (
              <li key={s.id} className="list-item" style={{ alignItems: "flex-start" }}>
                <div className="main">
                  <VideoSummary videoId={s.youtubeVideoId} title={s.title} channelName={s.channelName}>
                    <div className="sub">
                      Suggested {formatDateTime(s.createdAt)}{s.exerciseName ? ` · for ${s.exerciseName}` : ""}
                    </div>
                    <div style={{ marginTop: 4 }}><span className={`badge ${VIDEO_STATUS_TONES[s.status]}`}>{VIDEO_STATUS_LABELS[s.status]}</span></div>
                    {s.feedback && <div className="feedback-note"><strong>{s.reviewedBy ?? "Physiotherapist"}:</strong> {s.feedback}</div>}
                    {s.status === "REVISION_REQUESTED" && (
                      <button type="button" className="btn secondary sm" style={{ marginTop: 8 }} onClick={() => setEditing(s)}>Update suggestion</button>
                    )}
                  </VideoSummary>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}

function SuggestForm({ exercises, existing, onDone, onCancel }) {
  const [form, setForm] = useState({
    url: existing?.url ?? "", exerciseId: existing?.exerciseId ? String(existing.exerciseId) : "",
    description: existing?.description ?? "", reason: existing?.reason ?? "",
  });
  const [state, setState] = useState({ busy: false, error: null, ok: null });
  const videoId = extractYouTubeId(form.url);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    if (!videoId) return setState({ busy: false, error: "Paste a YouTube link (youtube.com/watch?v=…, youtu.be/… or youtube.com/shorts/…).", ok: null });
    setState({ busy: true, error: null, ok: null });
    const body = { url: form.url.trim(), exerciseId: form.exerciseId ? Number(form.exerciseId) : null, description: form.description.trim() || null, reason: form.reason.trim() || null };
    try {
      if (existing) await patientApi.resubmitVideo(existing.id, body);
      else await patientApi.suggestVideo(body);
      setForm({ url: "", exerciseId: "", description: "", reason: "" });
      setState({ busy: false, error: null, ok: "Sent to your physiotherapist for review." });
      onDone?.();
    } catch (err) {
      setState({ busy: false, error: errorMessage(err), ok: null });
    }
  }

  return (
    <form className="card" onSubmit={submit} noValidate>
      <h2>{existing ? "Update your suggestion" : "Suggest a YouTube video"}</h2>
      <p className="small muted">Your physiotherapist will check it before it appears in your videos.</p>
      <Field label="YouTube link" htmlFor="v-url" help={form.url && !videoId ? "This does not look like a YouTube video link." : "youtube.com/watch?v=…, youtu.be/… or youtube.com/shorts/…"}>
        <input id="v-url" className={`input ${form.url && !videoId ? "invalid" : ""}`} inputMode="url" autoComplete="off" value={form.url} onChange={set("url")} placeholder="https://youtu.be/…" />
      </Field>
      {videoId && <div style={{ maxWidth: 420, marginBottom: 14 }}><YouTubeEmbed videoId={videoId} title="Preview" /></div>}
      <Field label="Related exercise (optional)" htmlFor="v-ex">
        <select id="v-ex" className="input" value={form.exerciseId} onChange={set("exerciseId")}>
          <option value="">None</option>
          {exercises.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </Field>
      <Field label="What is the video about?" htmlFor="v-desc"><textarea id="v-desc" className="input" rows={2} maxLength={1000} value={form.description} onChange={set("description")} /></Field>
      <Field label="Why would you like to do this exercise?" htmlFor="v-reason"><textarea id="v-reason" className="input" rows={2} maxLength={1000} value={form.reason} onChange={set("reason")} /></Field>
      {state.error && <div className="alert error" style={{ marginBottom: 12 }}>{state.error}</div>}
      {state.ok && <div className="alert success" style={{ marginBottom: 12 }}>{state.ok}</div>}
      <div className="row">
        <button type="submit" className="btn" disabled={state.busy}>{state.busy ? "Sending…" : existing ? "Resubmit" : "Submit for review"}</button>
        {onCancel && <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}
