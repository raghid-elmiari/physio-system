import { useState } from "react";
import { Link } from "react-router-dom";
import { errorMessage, fieldErrors } from "../../api/client";
import { therapistApi } from "../../api/services";
import { useApi } from "../../lib/useApi";
import { DIFFICULTY_LABELS, MEASUREMENT_TYPES, formatExpected } from "../../lib/clinicalLabels";
import { EmptyState, ErrorState, Field, Spinner } from "../../components/ui";

const blankParam = () => ({ key: Math.random().toString(36).slice(2), id: null, code: "", label: "", measurementType: "ANGLE", unit: "deg",
  rangeMeasurement: false, minValid: "", maxValid: "", normalMin: "", normalMax: "", higherIsBetter: true, assessmentEnabled: true, cvMetricKey: "" });

const toForm = (e) => ({
  name: e?.name ?? "", description: e?.description ?? "", instructions: e?.instructions ?? "", cameraSetup: e?.cameraSetup ?? "",
  bodyRegion: e?.bodyRegion ?? "", category: e?.category ?? "", difficultyLevel: e?.difficultyLevel ?? "", defaultReps: e?.defaultReps ?? 10,
  parameters: (e?.parameters || []).filter((p) => p.active).map((p) => ({ ...p, key: `p${p.id}`, minValid: p.minValid ?? "", maxValid: p.maxValid ?? "",
    normalMin: p.normalMin ?? "", normalMax: p.normalMax ?? "", cvMetricKey: p.cvMetricKey ?? "" })),
});

/** Global exercise definitions and their measurement parameters. Patient prescriptions keep their own copies. */
export default function ExerciseLibrary() {
  const [includeArchived, setIncludeArchived] = useState(false);
  const library = useApi(() => therapistApi.library(includeArchived), [includeArchived]);
  const [editing, setEditing] = useState(null); // null | "new" | exercise
  const [message, setMessage] = useState(null);

  async function toggleArchive(e) {
    const archiving = e.active;
    if (!window.confirm(archiving
      ? `Archive "${e.name}"? It disappears from the library and cannot be newly prescribed. Existing prescriptions and history are kept.`
      : `Restore "${e.name}" to the library?`)) return;
    setMessage(null);
    try {
      if (archiving) await therapistApi.archiveExercise(e.id);
      else await therapistApi.restoreExercise(e.id);
      library.reload();
    } catch (err) {
      setMessage(errorMessage(err));
    }
  }

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Exercise library</h1>
          <p>Define exercises and what is measured for them. Editing here never changes existing patient prescriptions.</p>
        </div>
        <div className="row">
          <Link className="btn secondary" to="/therapist/exercises/new">New camera exercise from video</Link>
          {!editing && <button type="button" className="btn" onClick={() => setEditing("new")}>New exercise</button>}
        </div>
      </div>
      <div className="stack">
        {editing && (
          <ExerciseForm key={editing === "new" ? "new" : editing.id} exercise={editing === "new" ? null : editing}
            onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); library.reload(); }} />
        )}
        {message && <div className="alert error">{message}</div>}
        <section className="card">
          <div className="card-head">
            <h2>Exercises</h2>
            <label className="switch"><input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} /> Show archived</label>
          </div>
          {library.loading && <Spinner />}
          {library.error && <ErrorState message={library.error} onRetry={library.reload} />}
          {library.data?.length === 0 && <EmptyState title="No exercises" />}
          <ul className="list">
            {(library.data || []).map((e) => (
              <li key={e.id} className="list-item" style={{ alignItems: "flex-start" }}>
                <div className="main">
                  <div className="title">
                    {e.name}{" "}
                    {!e.active && <span className="badge danger">Archived</span>}{" "}
                    {e.cameraMonitoringSupported && <span className="badge primary">Camera coach</span>}{" "}
                    {e.category && <span className="badge">{e.category}</span>}{" "}
                    {e.difficultyLevel && <span className="badge">{DIFFICULTY_LABELS[e.difficultyLevel]}</span>}
                  </div>
                  <div className="sub">{[e.bodyRegion, `${e.defaultReps} reps default`, e.createdBy ? `by ${e.createdBy}` : null].filter(Boolean).join(" · ")}</div>
                  <div className="sub">
                    Measures: {e.parameters.filter((p) => p.active).map((p) => `${p.label} (${p.unit}${formatExpected(p) ? `, expected ${formatExpected(p)}` : ""})`).join("; ") || "nothing configured"}
                  </div>
                </div>
                <div className="actions row">
                  {e.active && <button type="button" className="btn secondary sm" onClick={() => { setEditing(e); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Edit</button>}
                  <button type="button" className={`btn sm ${e.active ? "ghost danger-text" : "secondary"}`} onClick={() => toggleArchive(e)}>{e.active ? "Archive" : "Restore"}</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}

function ExerciseForm({ exercise, onCancel, onSaved }) {
  const [form, setForm] = useState(() => toForm(exercise));
  const [state, setState] = useState({ busy: false, error: null, fields: {} });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const setParam = (idx, patch) => setForm({ ...form, parameters: form.parameters.map((p, i) => (i === idx ? { ...p, ...patch } : p)) });

  function validate() {
    const fields = {};
    if (!form.name.trim()) fields.name = "Required";
    if (!(Number.isInteger(Number(form.defaultReps)) && form.defaultReps >= 1 && form.defaultReps <= 100)) fields.defaultReps = "1–100";
    const codes = new Set();
    form.parameters.forEach((p, i) => {
      if (!/^[a-z][a-z0-9_]{0,49}$/.test(p.code)) fields[`p${i}`] = "Code: lower-case letters, digits and _ (e.g. knee_flexion)";
      else if (codes.has(p.code)) fields[`p${i}`] = "Codes must be unique";
      else if (!p.label.trim() || !p.unit.trim()) fields[`p${i}`] = "Label and unit are required";
      else if (p.minValid !== "" && p.maxValid !== "" && Number(p.minValid) > Number(p.maxValid)) fields[`p${i}`] = "Possible range is inverted";
      else if (p.normalMin !== "" && p.normalMax !== "" && Number(p.normalMin) > Number(p.normalMax)) fields[`p${i}`] = "Expected range is inverted";
      codes.add(p.code);
    });
    return fields;
  }

  async function submit(e) {
    e.preventDefault();
    const fields = validate();
    if (Object.keys(fields).length) return setState({ busy: false, error: "Check the highlighted fields.", fields });
    setState({ busy: true, error: null, fields: {} });
    const num = (v) => (v === "" || v == null ? null : Number(v));
    const body = {
      name: form.name.trim(), description: form.description.trim() || null, instructions: form.instructions.trim() || null,
      cameraSetup: form.cameraSetup.trim() || null, bodyRegion: form.bodyRegion.trim() || null, category: form.category.trim() || null,
      difficultyLevel: form.difficultyLevel || null, defaultReps: Number(form.defaultReps),
      parameters: form.parameters.map((p) => ({
        id: p.id, code: p.code, label: p.label.trim(), measurementType: p.measurementType, unit: p.unit.trim(), rangeMeasurement: p.rangeMeasurement,
        minValid: num(p.minValid), maxValid: num(p.maxValid), normalMin: num(p.normalMin), normalMax: num(p.normalMax),
        higherIsBetter: p.higherIsBetter, assessmentEnabled: p.assessmentEnabled, cvMetricKey: p.cvMetricKey.trim() || null,
      })),
    };
    try {
      if (exercise) await therapistApi.updateLibraryExercise(exercise.id, body);
      else await therapistApi.createLibraryExercise(body);
      onSaved();
    } catch (err) {
      setState({ busy: false, error: errorMessage(err), fields: fieldErrors(err) });
    }
  }

  return (
    <form className="card" onSubmit={submit} noValidate>
      <h2>{exercise ? `Edit ${exercise.name}` : "New exercise"}</h2>
      <div className="grid cols-3" style={{ gap: 0, columnGap: 12 }}>
        <Field label="Name" htmlFor="ex-name" error={state.fields.name}><input id="ex-name" className="input" maxLength={150} value={form.name} onChange={set("name")} /></Field>
        <Field label="Category" htmlFor="ex-cat" help="e.g. Lower limb, Balance"><input id="ex-cat" className="input" maxLength={50} value={form.category} onChange={set("category")} /></Field>
        <Field label="Body region" htmlFor="ex-region"><input id="ex-region" className="input" maxLength={50} value={form.bodyRegion} onChange={set("bodyRegion")} /></Field>
        <Field label="Difficulty" htmlFor="ex-diff">
          <select id="ex-diff" className="input" value={form.difficultyLevel} onChange={set("difficultyLevel")}>
            <option value="">Not set</option>
            {Object.entries(DIFFICULTY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Default repetitions" htmlFor="ex-reps" error={state.fields.defaultReps}><input id="ex-reps" type="number" min="1" max="100" className="input" value={form.defaultReps} onChange={(e) => setForm({ ...form, defaultReps: e.target.value === "" ? "" : Number(e.target.value) })} /></Field>
      </div>
      <Field label="Description" htmlFor="ex-desc"><textarea id="ex-desc" className="input" rows={2} maxLength={5000} value={form.description} onChange={set("description")} /></Field>
      <Field label="Instructions (one step per line)" htmlFor="ex-instr"><textarea id="ex-instr" className="input" rows={4} maxLength={5000} value={form.instructions} onChange={set("instructions")} /></Field>

      <h3>Measurements</h3>
      <p className="small muted">What is recorded in assessments, targets and performance. Type, unit and range shape cannot change after creation, because recorded values depend on them; remove a measurement to archive it.</p>
      <div className="stack" style={{ gap: 10 }}>
        {form.parameters.map((p, idx) => {
          const locked = p.id != null;
          return (
            <div key={p.key} className="param-row">
              <Field label="Label" htmlFor={`pl-${p.key}`}><input id={`pl-${p.key}`} className="input" maxLength={100} value={p.label} onChange={(e) => setParam(idx, { label: e.target.value })} /></Field>
              <Field label="Code" htmlFor={`pc-${p.key}`}><input id={`pc-${p.key}`} className="input" maxLength={50} disabled={locked} value={p.code} onChange={(e) => setParam(idx, { code: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })} /></Field>
              <Field label="Type" htmlFor={`pt-${p.key}`}>
                <select id={`pt-${p.key}`} className="input" disabled={locked} value={p.measurementType} onChange={(e) => setParam(idx, { measurementType: e.target.value, unit: MEASUREMENT_TYPES[e.target.value].unit || p.unit })}>
                  {Object.entries(MEASUREMENT_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </Field>
              <Field label="Unit" htmlFor={`pu-${p.key}`}><input id={`pu-${p.key}`} className="input" maxLength={20} disabled={locked} value={p.unit} onChange={(e) => setParam(idx, { unit: e.target.value })} /></Field>
              <Field label="Lowest possible" htmlFor={`pmin-${p.key}`}><input id={`pmin-${p.key}`} type="number" step="any" className="input" value={p.minValid} onChange={(e) => setParam(idx, { minValid: e.target.value })} /></Field>
              <Field label="Highest possible" htmlFor={`pmax-${p.key}`}><input id={`pmax-${p.key}`} type="number" step="any" className="input" value={p.maxValid} onChange={(e) => setParam(idx, { maxValid: e.target.value })} /></Field>
              <Field label="Expected from" htmlFor={`pnmin-${p.key}`}><input id={`pnmin-${p.key}`} type="number" step="any" className="input" value={p.normalMin} onChange={(e) => setParam(idx, { normalMin: e.target.value })} /></Field>
              <Field label="Expected to" htmlFor={`pnmax-${p.key}`}><input id={`pnmax-${p.key}`} type="number" step="any" className="input" value={p.normalMax} onChange={(e) => setParam(idx, { normalMax: e.target.value })} /></Field>
              <label className="switch"><input type="checkbox" disabled={locked} checked={p.rangeMeasurement} onChange={(e) => setParam(idx, { rangeMeasurement: e.target.checked })} /> Range (min–max)</label>
              <label className="switch"><input type="checkbox" checked={p.higherIsBetter} onChange={(e) => setParam(idx, { higherIsBetter: e.target.checked })} /> Higher is better</label>
              <label className="switch"><input type="checkbox" checked={p.assessmentEnabled} onChange={(e) => setParam(idx, { assessmentEnabled: e.target.checked })} /> In assessments</label>
              <div className="row">
                <Field label="Camera metric key" htmlFor={`pcv-${p.key}`} help="Optional, for computer vision"><input id={`pcv-${p.key}`} className="input" maxLength={64} value={p.cvMetricKey} onChange={(e) => setParam(idx, { cvMetricKey: e.target.value })} /></Field>
                <button type="button" className="btn ghost sm danger-text" onClick={() => setForm({ ...form, parameters: form.parameters.filter((_, i) => i !== idx) })}>Remove</button>
              </div>
              {state.fields[`p${idx}`] && <div className="error small" role="alert" style={{ color: "var(--danger)" }}>{state.fields[`p${idx}`]}</div>}
            </div>
          );
        })}
        <div><button type="button" className="btn secondary sm" onClick={() => setForm({ ...form, parameters: [...form.parameters, blankParam()] })}>Add measurement</button></div>
      </div>
      {state.error && <div className="alert error" style={{ margin: "12px 0" }}>{state.error}</div>}
      <div className="row" style={{ marginTop: 14 }}>
        <button type="submit" className="btn" disabled={state.busy}>{state.busy ? "Saving…" : exercise ? "Save changes" : "Create exercise"}</button>
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
