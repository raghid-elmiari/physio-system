import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { errorMessage, fieldErrors } from "../../api/client";
import { exercisesApi, therapistApi } from "../../api/services";
import { useApi } from "../../lib/useApi";
import { ErrorState, Field, Spinner } from "../../components/ui";
import { analyzeRecording, buildReference } from "../../core/reference/buildReference";
import { FEATURES } from "../../core/reference/features";
import { extractPoseFromVideo, MAX_VIDEO_SECONDS } from "../../platform/pose/videoPoseExtractor";

// Therapist tool: turn a demonstration video into an exercise that patients are compared
// against (analyzer "reference_dtw"). Everything runs in the browser; only joint-angle
// curves are saved, never the video.

const EMPTY_FORM = { name: "", description: "", instructions: "", cameraSetup: "", bodyRegion: "", defaultReps: 10 };

export default function ReferenceBuilder() {
  const { exerciseId } = useParams();
  const existing = useApi(() => (exerciseId ? exercisesApi.get(exerciseId) : Promise.resolve(null)), [exerciseId]);
  if (existing.loading) return <main className="page"><Spinner /></main>;
  if (existing.error) return <main className="page"><ErrorState message={existing.error} onRetry={existing.reload} /></main>;
  return <Builder key={exerciseId || "new"} exerciseId={exerciseId} exercise={existing.data} />;
}

function formFrom(e) {
  if (!e) return EMPTY_FORM;
  return {
    name: e.name || "", description: e.description || "", instructions: e.instructions || "",
    cameraSetup: e.cameraSetup || "", bodyRegion: e.bodyRegion || "", defaultReps: e.defaultReps || 10,
  };
}

function Builder({ exerciseId, exercise }) {
  const navigate = useNavigate();

  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [extract, setExtract] = useState({ status: "idle", progress: 0, error: null, detectedPct: null });
  const framesRef = useRef(null);
  const abortRef = useRef(null);
  const [opts, setOpts] = useState({ primary: null, invert: false });
  const [analysis, setAnalysis] = useState(null);
  const [selected, setSelected] = useState([]);
  const [repSel, setRepSel] = useState([]);
  const [form, setForm] = useState(() => formFrom(exercise));
  const [save, setSave] = useState({ busy: false, error: null, fields: {} });

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => () => previewUrl && URL.revokeObjectURL(previewUrl), [previewUrl]);

  function chooseFile(f) {
    abortRef.current?.abort();
    setFile(f);
    setPreviewUrl(f ? URL.createObjectURL(f) : null);
    setExtract({ status: "idle", progress: 0, error: null, detectedPct: null });
    framesRef.current = null;
    setAnalysis(null);
  }

  function analyse(frames, o) {
    const a = analyzeRecording(frames, o);
    setAnalysis(a);
    setSelected(a.defaultSelected);
    setRepSel(a.reps.map((_, i) => i));
  }

  async function processVideo() {
    if (!file) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setExtract({ status: "running", progress: 0, error: null, detectedPct: null });
    try {
      const res = await extractPoseFromVideo(file, { signal: ctrl.signal, onProgress: (p) => setExtract((s) => ({ ...s, progress: p })) });
      framesRef.current = res.frames;
      const o = { primary: null, invert: false };
      setOpts(o);
      analyse(res.frames, o);
      setExtract({ status: "done", progress: 1, error: null, detectedPct: res.detectedPct });
    } catch (err) {
      if (err?.name === "AbortError") return;
      setExtract({ status: "error", progress: 0, error: err?.message || String(err), detectedPct: null });
    }
  }

  function changeOpts(next) {
    const o = { ...opts, ...next };
    setOpts(o);
    analyse(framesRef.current, o);
  }

  const built = useMemo(() => {
    if (!analysis) return null;
    try {
      return { reference: buildReference(analysis, { features: selected, repIndices: repSel }) };
    } catch (err) {
      return { error: err.message };
    }
  }, [analysis, selected, repSel]);

  async function submit(e) {
    e.preventDefault();
    const fields = {};
    if (!form.name.trim()) fields.name = "Give the exercise a name";
    if (!(form.defaultReps >= 1 && form.defaultReps <= 100)) fields.defaultReps = "1-100 repetitions";
    if (!built?.reference) {
      setSave({ busy: false, error: "Process a video with at least one complete repetition first.", fields });
      return;
    }
    if (Object.keys(fields).length) {
      setSave({ busy: false, error: null, fields });
      return;
    }
    setSave({ busy: true, error: null, fields: {} });
    const body = {
      ...form,
      name: form.name.trim(),
      description: form.description || null,
      instructions: form.instructions || null,
      cameraSetup: form.cameraSetup || null,
      bodyRegion: form.bodyRegion || null,
      analysisConfig: { reference: built.reference },
    };
    try {
      const saved = exerciseId ? await therapistApi.updateReferenceExercise(exerciseId, body) : await therapistApi.createReferenceExercise(body);
      navigate(`/exercises/${saved.id}`);
    } catch (err) {
      setSave({ busy: false, error: errorMessage(err), fields: fieldErrors(err) });
    }
  }

  const ref = built?.reference;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p><Link to={exerciseId ? `/exercises/${exerciseId}` : "/exercises"}>← {exerciseId ? "Exercise" : "Exercises"}</Link></p>
          <h1>{exerciseId ? "Replace reference recording" : "New exercise from a video"}</h1>
          <p>Patients will be compared with the movement in this video, repetition by repetition.</p>
        </div>
      </div>

      <div className="grid cols-2">
        <section className="card">
          <h2>1. Demonstration video</h2>
          <ul className="small muted">
            <li>One person, whole body part visible, fixed camera, no cuts or zoom.</li>
            <li>Start and finish at rest; 3-5 slow, correct repetitions.</li>
            <li>Film from the same angle patients will use (usually facing the camera).</li>
            <li>Use a video you recorded or have the rights to use. It stays on this device.</li>
          </ul>
          <Field label="Video file" htmlFor="ref-video" help={`MP4 recommended, up to ${MAX_VIDEO_SECONDS / 60} minutes.`}>
            <input id="ref-video" type="file" accept="video/*" className="input" onChange={(e) => chooseFile(e.target.files?.[0] || null)} />
          </Field>
          {previewUrl && <video src={previewUrl} controls muted playsInline style={{ width: "100%", borderRadius: 10, background: "#000" }} />}
          <div className="row" style={{ marginTop: 12 }}>
            <button type="button" className="btn" disabled={!file || extract.status === "running"} onClick={processVideo}>
              {extract.status === "running" ? "Processing…" : extract.status === "done" ? "Process again" : "Process video"}
            </button>
            {extract.status === "running" && <button type="button" className="btn ghost" onClick={() => { abortRef.current?.abort(); setExtract({ status: "idle", progress: 0, error: null, detectedPct: null }); }}>Cancel</button>}
          </div>
          {extract.status === "running" && (
            <div style={{ marginTop: 12 }}>
              <div className="progress-bar" role="progressbar" aria-valuenow={Math.round(extract.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                <span style={{ width: `${Math.round(extract.progress * 100)}%` }} />
              </div>
              <p className="small muted">Detecting the pose in every frame ({Math.round(extract.progress * 100)}%). The first run also loads the pose model.</p>
            </div>
          )}
          {extract.error && <div className="alert error" style={{ marginTop: 12 }}>{extract.error}</div>}
          {extract.status === "done" && extract.detectedPct < 80 && (
            <div className="alert warning" style={{ marginTop: 12 }}>A person was detected in only {extract.detectedPct}% of the frames. Check lighting and that the whole body part is in view.</div>
          )}
        </section>

        <section className="card">
          <h2>2. Movement found</h2>
          {!analysis && <p className="muted">Process a video to see the joints and repetitions it contains.</p>}
          {analysis && !analysis.primary && <div className="alert warning">No joint moved more than {analysis.options.minRangeDeg}°. Check that the whole movement is visible.</div>}
          {analysis?.primary && (
            <>
              <RecordingChart analysis={analysis} repSel={repSel} />
              <div className="row small" style={{ margin: "8px 0 12px" }}>
                <label className="switch">
                  Main joint
                  <select className="input" value={analysis.primary} onChange={(e) => changeOpts({ primary: e.target.value })}>
                    {analysis.moving.map((k) => <option key={k} value={k}>{FEATURES[k].label}</option>)}
                  </select>
                </label>
                <label className="switch">
                  <input type="checkbox" checked={opts.invert} onChange={(e) => changeOpts({ invert: e.target.checked })} />
                  Rest position is at the other end
                </label>
              </div>

              <h3>Repetitions ({analysis.reps.length} found)</h3>
              {analysis.reps.length === 0 && <div className="alert warning">No complete repetition (rest → movement → rest) was found.</div>}
              <div className="row small">
                {analysis.reps.map((r, i) => (
                  <label key={r.start} className="switch">
                    <input type="checkbox" checked={repSel.includes(i)} onChange={(e) => setRepSel(e.target.checked ? [...repSel, i].sort((a, b) => a - b) : repSel.filter((x) => x !== i))} />
                    #{i + 1} · {(r.durationMs / 1000).toFixed(1)} s
                  </label>
                ))}
              </div>

              <h3 style={{ marginTop: 14 }}>Joints to compare</h3>
              <div className="row small">
                {analysis.usable.map((k) => (
                  <label key={k} className="switch" title={`Range in the video: ${Math.round(analysis.range[k])}°`}>
                    <input type="checkbox" disabled={k === analysis.primary} checked={k === analysis.primary || selected.includes(k)}
                      onChange={(e) => setSelected(e.target.checked ? [...selected, k] : selected.filter((x) => x !== k))} />
                    {FEATURES[k].label} <span className="muted">({Math.round(analysis.range[k])}°)</span>
                  </label>
                ))}
              </div>
              <p className="small muted">Joints that are not visible in most of the video cannot be used. Unchecked joints are ignored for patients.</p>

              {built?.error && <div className="alert error">{built.error}</div>}
              {ref && (
                <div className="metric-grid" style={{ marginTop: 12 }}>
                  <Metric k="Range" v={`${Math.round(ref.restValue)}° → ${Math.round(ref.peakValue)}°`} />
                  <Metric k="Rep duration" v={`${(ref.stats.meanDurationMs / 1000).toFixed(1)} s`} />
                  <Metric k="Consistency" v={ref.stats.selfDistanceDeg == null ? "1 rep" : `${ref.stats.selfDistanceDeg}° apart`} />
                  <Metric k="Pass threshold" v={`≤ ${ref.stats.dtwThresholdDeg}° avg`} />
                </div>
              )}
            </>
          )}
        </section>
      </div>

      <form className="card" style={{ marginTop: 16 }} onSubmit={submit} noValidate>
        <h2>3. Exercise details</h2>
        <div className="grid cols-2">
          <Field label="Name" htmlFor="ref-name" error={save.fields.name}><input id="ref-name" className="input" maxLength={150} value={form.name} onChange={set("name")} /></Field>
          <div className="row">
            <Field label="Body region" htmlFor="ref-region" error={save.fields.bodyRegion}><input id="ref-region" className="input" maxLength={50} value={form.bodyRegion} onChange={set("bodyRegion")} /></Field>
            <Field label="Default reps" htmlFor="ref-reps" error={save.fields.defaultReps}>
              <input id="ref-reps" type="number" min="1" max="100" className="input" value={form.defaultReps} onChange={(e) => setForm({ ...form, defaultReps: e.target.value === "" ? "" : Number(e.target.value) })} />
            </Field>
          </div>
        </div>
        <Field label="Description" htmlFor="ref-desc" error={save.fields.description}><textarea id="ref-desc" className="input" rows={2} maxLength={5000} value={form.description} onChange={set("description")} /></Field>
        <Field label="Instructions (one step per line)" htmlFor="ref-steps" error={save.fields.instructions}><textarea id="ref-steps" className="input" rows={3} maxLength={5000} value={form.instructions} onChange={set("instructions")} /></Field>
        <Field label="Camera setup" htmlFor="ref-cam" error={save.fields.cameraSetup}><input id="ref-cam" className="input" maxLength={500} placeholder="e.g. Face the camera, 2-3 m away, whole upper body visible" value={form.cameraSetup} onChange={set("cameraSetup")} /></Field>
        {save.error && <div className="alert error" style={{ marginBottom: 12 }}>{save.error}</div>}
        <p className="small muted">Matching a reference is not a clinical assessment: review the pass threshold by trying the exercise yourself before assigning it.</p>
        <button type="submit" className="btn lg" disabled={save.busy}>{save.busy ? "Saving…" : exerciseId ? "Save new reference" : "Create exercise"}</button>
      </form>
    </main>
  );
}

/** Main-joint angle over the whole video, with the detected repetitions shaded. */
function RecordingChart({ analysis, repSel }) {
  const values = analysis.series[analysis.primary];
  const W = 600;
  const H = 150;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const x = (i) => (i / Math.max(1, values.length - 1)) * W;
  const y = (v) => H - 10 - ((v - lo) / (hi - lo || 1)) * (H - 20);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${FEATURES[analysis.primary].label} angle over the video with ${analysis.reps.length} repetitions`}
      style={{ background: "var(--surface-2)", borderRadius: 10 }}>
      {analysis.reps.map((r, i) => (
        <rect key={r.start} x={x(r.start)} y={0} width={x(r.end) - x(r.start)} height={H}
          fill={repSel.includes(i) ? "var(--primary-soft)" : "transparent"} stroke="var(--primary)" strokeOpacity={0.3} />
      ))}
      <path d={d} fill="none" stroke="var(--primary)" strokeWidth={2} />
      <text x={6} y={14} fontSize={12} fill="var(--muted)">{FEATURES[analysis.primary].label}: {Math.round(lo)}°-{Math.round(hi)}°</text>
    </svg>
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
