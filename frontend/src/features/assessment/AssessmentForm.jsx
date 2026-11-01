import { Field } from "../../components/ui";
import { MeasurementFields, SourceBadge } from "../../components/clinical";
import { formatExpected, formatMeasured, formatValue } from "../../lib/clinicalLabels";

const DIFFICULTY = { 1: "Very easy", 2: "Easy", 3: "Moderate", 4: "Hard", 5: "Could not do it" };

const emptyItem = (exerciseId) => ({ exerciseId, painLevel: "", difficultyRating: "", independent: "", limitationNotes: "", values: {} });

/**
 * Per exercise: measured values for its assessment parameters, pain (0–10), difficulty (1–5),
 * whether the movement is done independently, and notes on limitations.
 */
export default function AssessmentForm({ form, onChange, exercises, notesLabel = "Anything your physiotherapist should know" }) {
  const byId = new Map((exercises || []).map((e) => [e.id, e]));
  const chosen = new Set(form.items.map((i) => i.exerciseId));
  const available = (exercises || []).filter((e) => !chosen.has(e.id));
  const setItem = (idx, patch) => onChange({ ...form, items: form.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)) });

  return (
    <div className="stack">
      {form.items.length === 0 && <p className="muted">Add the movements you want to assess.</p>}
      {form.items.map((item, idx) => {
        const exercise = byId.get(item.exerciseId);
        const params = (exercise?.parameters || []).filter((p) => p.active && p.assessmentEnabled);
        return (
          <section key={item.exerciseId} className="card">
            <div className="card-head">
              <h2>{exercise?.name ?? `Exercise #${item.exerciseId}`}</h2>
              <button type="button" className="btn ghost sm danger-text" onClick={() => onChange({ ...form, items: form.items.filter((_, i) => i !== idx) })}>Remove</button>
            </div>
            {exercise?.instructions && <details className="panel small"><summary>How to do the movement</summary><p className="preserve-lines">{exercise.instructions}</p></details>}
            <MeasurementFields parameters={params} values={item.values} onChange={(values) => setItem(idx, { values })} idPrefix={`a${item.exerciseId}`} />
            <div className="grid cols-3" style={{ gap: 0, columnGap: 12, marginTop: 12 }}>
              <Field label="Pain or discomfort (0–10)" htmlFor={`pain-${idx}`}>
                <select id={`pain-${idx}`} className="input" value={item.painLevel} onChange={(e) => setItem(idx, { painLevel: e.target.value === "" ? "" : Number(e.target.value) })}>
                  <option value="">Not rated</option>
                  {Array.from({ length: 11 }, (_, n) => <option key={n} value={n}>{n}{n === 0 ? " – none" : n === 10 ? " – worst" : ""}</option>)}
                </select>
              </Field>
              <Field label="Difficulty" htmlFor={`diff-${idx}`}>
                <select id={`diff-${idx}`} className="input" value={item.difficultyRating} onChange={(e) => setItem(idx, { difficultyRating: e.target.value === "" ? "" : Number(e.target.value) })}>
                  <option value="">Not rated</option>
                  {Object.entries(DIFFICULTY).map(([v, l]) => <option key={v} value={v}>{v} – {l}</option>)}
                </select>
              </Field>
              <Field label="Done without help?" htmlFor={`ind-${idx}`}>
                <select id={`ind-${idx}`} className="input" value={item.independent} onChange={(e) => setItem(idx, { independent: e.target.value })}>
                  <option value="">Not answered</option>
                  <option value="true">Yes, independently</option>
                  <option value="false">No, I need help</option>
                </select>
              </Field>
            </div>
            <Field label="Limitations (e.g. stiffness, where it stops)" htmlFor={`lim-${idx}`}>
              <textarea id={`lim-${idx}`} className="input" rows={2} maxLength={1000} value={item.limitationNotes} onChange={(e) => setItem(idx, { limitationNotes: e.target.value })} />
            </Field>
          </section>
        );
      })}
      {available.length > 0 && (
        <div className="row">
          <label className="inline-field" style={{ flex: 1 }}>Add a movement to assess
            <select className="input" value="" onChange={(e) => e.target.value && onChange({ ...form, items: [...form.items, emptyItem(Number(e.target.value))] })}>
              <option value="">Choose an exercise…</option>
              {available.map((e) => <option key={e.id} value={e.id}>{e.name}{e.bodyRegion ? ` (${e.bodyRegion})` : ""}</option>)}
            </select>
          </label>
        </div>
      )}
      <Field label={notesLabel} htmlFor="assess-notes">
        <textarea id="assess-notes" className="input" rows={3} maxLength={2000} value={form.notes} onChange={(e) => onChange({ ...form, notes: e.target.value })} />
      </Field>
    </div>
  );
}

/** Stored assessment, read-only. `renderMeasurementActions(item, measurement)` adds per-row controls. */
export function AssessmentReadOnly({ assessment, renderMeasurementActions, showSuperseded = true }) {
  return (
    <div className="stack">
      {assessment.patientNotes && <div className="card"><h3>Notes</h3><p className="preserve-lines">{assessment.patientNotes}</p></div>}
      {assessment.items.map((item) => (
        <section key={item.id} className="card">
          <h2>{item.exerciseName}</h2>
          <p className="small muted">
            Pain {item.painLevel ?? "—"}/10 · Difficulty {item.difficultyRating ? `${item.difficultyRating}/5 (${DIFFICULTY[item.difficultyRating]})` : "—"} ·
            {item.independent == null ? " Independence not answered" : item.independent ? " Done independently" : " Needs help"}
          </p>
          {item.limitationNotes && <p className="small">Limitations: “{item.limitationNotes}”</p>}
          {item.measurements.length === 0 ? <p className="muted small">No values recorded.</p> : (
            <div className="table-wrap">
              <table className="table responsive">
                <thead><tr><th>Measurement</th><th>Value</th><th>Expected</th><th>Difference</th><th>Source</th><th /></tr></thead>
                <tbody>
                  {item.measurements.filter((m) => showSuperseded || !m.superseded).map((m) => (
                    <tr key={m.id} style={m.superseded ? { opacity: 0.55 } : undefined}>
                      <td className="primary">{m.label}{m.superseded && <span className="badge" style={{ marginLeft: 6 }}>Corrected</span>}</td>
                      <td data-label="Value">{formatMeasured(m)}{m.flagged && <span className="badge warning" title={m.flagReason} style={{ marginLeft: 6 }}>Check</span>}</td>
                      <td data-label="Expected">{formatExpected(m) ?? "—"}</td>
                      <td data-label="Difference">{m.differenceFromExpected != null ? formatValue(m.differenceFromExpected, m.unit) : "—"}</td>
                      <td data-label="Source"><SourceBadge source={m.source} />{m.note ? <div className="small muted">“{m.note}”{m.recordedBy ? ` – ${m.recordedBy}` : ""}</div> : null}</td>
                      <td>{renderMeasurementActions?.(item, m)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
