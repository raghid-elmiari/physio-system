// Building blocks shared by the assessment, performance, progress and video screens.
import { formatCalendarDate, formatDate, formatDateTime } from "../lib/format";
import {
  PRESCRIPTION_STATUS_LABELS,
  PRESCRIPTION_STATUS_TONES,
  SOURCE_LABELS,
  SOURCE_SHORT,
  SOURCE_TONES,
  formatExpected,
  formatMeasured,
  formatValue,
} from "../lib/clinicalLabels";
import { embedUrl, thumbnailUrl } from "../lib/youtube";
import { EmptyState } from "./ui";

export function SourceBadge({ source, long = false }) {
  if (!source) return null;
  return (
    <span className={`badge ${SOURCE_TONES[source] ?? ""}`} title={SOURCE_LABELS[source]}>
      {long ? SOURCE_LABELS[source] : SOURCE_SHORT[source] ?? source}
    </span>
  );
}

export function PrescriptionStatusBadge({ status }) {
  return <span className={`badge ${PRESCRIPTION_STATUS_TONES[status] ?? ""}`}>{PRESCRIPTION_STATUS_LABELS[status] ?? status}</span>;
}

/**
 * YouTube player built only from a validated 11-character ID (never user HTML). No autoplay;
 * privacy-enhanced domain; loaded lazily.
 */
export function YouTubeEmbed({ videoId, title }) {
  const src = embedUrl(videoId);
  if (!src) return <div className="alert error">This video link is not valid.</div>;
  return (
    <div className="video-frame">
      <iframe
        src={src}
        title={title || "YouTube video"}
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
        allow="encrypted-media; picture-in-picture"
        allowFullScreen
      />
    </div>
  );
}

/** Thumbnail + title + channel; the thumbnail URL is derived from the ID, not taken from input. */
export function VideoSummary({ videoId, title, channelName, children }) {
  const thumb = thumbnailUrl(videoId);
  return (
    <div className="video-summary">
      {thumb && <img src={thumb} alt="" loading="lazy" width={160} height={90} />}
      <div className="main">
        <div className="title">{title || "Title unavailable"}</div>
        {channelName && <div className="sub">{channelName}</div>}
        {children}
      </div>
    </div>
  );
}

/**
 * Inputs for a set of exercise parameters. `values` maps parameterId → {value, valueMin, valueMax}.
 * Range parameters get minimum + maximum inputs; others a single value.
 */
export function MeasurementFields({ parameters, values, onChange, errors = {}, idPrefix = "m", showExpected = true, baseline }) {
  if (!parameters?.length) return <p className="small muted">This exercise has no measurement parameters configured.</p>;
  const set = (pid, key, raw) => {
    const next = { ...(values[pid] || {}) };
    next[key] = raw === "" ? "" : Number(raw);
    onChange({ ...values, [pid]: next });
  };
  return (
    <div className="measure-grid">
      {parameters.map((p) => {
        const v = values[p.id] || {};
        const expected = showExpected ? formatExpected(p) : null;
        const base = baseline?.[p.id];
        const help = [expected && `Expected ${expected}`, base && `Baseline ${formatMeasured(base, p.unit)}`,
          p.minValid != null || p.maxValid != null ? `Allowed ${p.minValid ?? "…"}–${p.maxValid ?? "…"} ${p.unit}` : null]
          .filter(Boolean).join(" · ");
        return (
          <fieldset key={p.id} className="measure-field">
            <legend>{p.label} <span className="muted small">({p.unit})</span></legend>
            {p.rangeMeasurement ? (
              <div className="row">
                <label className="inline-field">Minimum
                  <input id={`${idPrefix}-${p.id}-min`} type="number" step="any" inputMode="decimal" className={`input ${errors[p.id] ? "invalid" : ""}`}
                    value={v.valueMin ?? ""} onChange={(e) => set(p.id, "valueMin", e.target.value)} />
                </label>
                <label className="inline-field">Maximum
                  <input id={`${idPrefix}-${p.id}-max`} type="number" step="any" inputMode="decimal" className={`input ${errors[p.id] ? "invalid" : ""}`}
                    value={v.valueMax ?? ""} onChange={(e) => set(p.id, "valueMax", e.target.value)} />
                </label>
              </div>
            ) : (
              <input id={`${idPrefix}-${p.id}`} type="number" step="any" inputMode="decimal" aria-label={p.label} className={`input ${errors[p.id] ? "invalid" : ""}`}
                value={v.value ?? ""} onChange={(e) => set(p.id, "value", e.target.value)} />
            )}
            {help && <span className="help small muted">{help}</span>}
            {errors[p.id] && <span className="error small" role="alert">{errors[p.id]}</span>}
          </fieldset>
        );
      })}
    </div>
  );
}

/** Line chart of one parameter over time with dashed baseline and target references. */
export function ValueHistoryChart({ history, baseline, target, unit, label, height = 170 }) {
  const comparable = (p) => (p.value != null ? p.value : p.valueMin != null && p.valueMax != null ? p.valueMax - p.valueMin : p.valueMax);
  const points = (history || []).map((h) => ({ ...h, y: comparable(h) })).filter((h) => h.y != null);
  if (points.length === 0) return <p className="small muted">No recorded values in this period yet.</p>;
  const refs = [baseline, target].filter((v) => v != null);
  const ys = [...points.map((p) => p.y), ...refs];
  let lo = Math.min(...ys);
  let hi = Math.max(...ys);
  if (lo === hi) { lo -= 1; hi += 1; }
  const padY = (hi - lo) * 0.1;
  lo -= padY; hi += padY;
  const W = 640, H = height, pad = { l: 44, r: 14, t: 12, b: 24 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const x = (i) => pad.l + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (v) => pad.t + ih - ((v - lo) / (hi - lo)) * ih;
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join(" ");
  const latest = points[points.length - 1];
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}: ${points.length} values, latest ${formatValue(latest.y, unit)}${target != null ? `, target ${formatValue(target, unit)}` : ""}`}>
        {[lo, (lo + hi) / 2, hi].map((v, i) => (
          <g key={i}>
            <line className="grid-line" x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} />
            <text x={pad.l - 6} y={y(v) + 4} textAnchor="end">{formatValue(v, unit)}</text>
          </g>
        ))}
        {baseline != null && <line className="ref-line baseline" x1={pad.l} x2={W - pad.r} y1={y(baseline)} y2={y(baseline)}><title>Baseline {formatValue(baseline, unit)}</title></line>}
        {target != null && <line className="ref-line target" x1={pad.l} x2={W - pad.r} y1={y(target)} y2={y(target)}><title>Target {formatValue(target, unit)}</title></line>}
        <path className="line" d={path} />
        {points.map((p, i) => (
          <circle key={i} className={`dot ${p.source === "COMPUTER_VISION" ? "auto" : ""}`} cx={x(i)} cy={y(p.y)} r={4}>
            <title>{`${formatDateTime(p.at)} · ${formatValue(p.y, unit)} · ${SOURCE_LABELS[p.source] ?? p.source}`}</title>
          </circle>
        ))}
        <text x={pad.l} y={H - 6}>{formatDate(points[0].at)}</text>
        {points.length > 1 && <text x={W - pad.r} y={H - 6} textAnchor="end">{formatDate(latest.at)}</text>}
      </svg>
      <div className="chart-legend small muted">
        <span><i className="swatch line" /> Recorded</span>
        {baseline != null && <span><i className="swatch baseline" /> Baseline</span>}
        {target != null && <span><i className="swatch target" /> Target</span>}
      </div>
    </div>
  );
}

function progressCell(row) {
  if (row.progressPct == null) return <span className="muted small">{row.progressNote || "—"}</span>;
  const pct = Math.max(0, Math.min(100, row.progressPct));
  return (
    <div style={{ minWidth: 110 }}>
      <div className="progress-bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
      <span className="small">{row.progressPct}% of the gap closed</span>
    </div>
  );
}

/**
 * Baseline vs target vs latest per prescription (backend ClinicalDtos.RehabProgressResponse).
 * `compact` hides the charts (used in printed reports).
 */
export function RehabProgressView({ data, compact = false }) {
  if (!data) return null;
  const rows = data.prescriptions || [];
  return (
    <div className="stack">
      <div className="grid cols-4">
        <div className="card stat"><span className="label">Targets tracked</span><span className="value">{data.targetsTracked}</span></div>
        <div className="card stat"><span className="label">Targets reached</span><span className="value">{data.targetsReached}</span></div>
        <div className="card stat"><span className="label">Average progress</span><span className="value">{data.averageProgressPct != null ? `${data.averageProgressPct}%` : "—"}</span><span className="hint">Where a percentage is meaningful</span></div>
        <div className="card stat"><span className="label">Baseline</span><span className="value" style={{ fontSize: "1.05rem" }}>{data.baselineApprovedAt ? formatDate(data.baselineApprovedAt) : "Not approved yet"}</span></div>
      </div>
      <p className="small muted">
        Period {formatCalendarDate(data.periodStart)} – {formatCalendarDate(data.periodEnd)} · Sources: {data.sources?.length ? data.sources.map((s) => SOURCE_LABELS[s] ?? s).join(", ") : "none yet"}.
        {" "}{data.disclaimer}
      </p>
      {data.exercisesRequiringAttention?.length > 0 && (
        <div className="alert warning">Requires attention: {data.exercisesRequiringAttention.join(", ")}</div>
      )}
      {rows.length === 0 && <div className="card"><EmptyState icon="📈" title="Nothing to compare yet">Comparisons appear once exercises are prescribed and performed.</EmptyState></div>}
      {rows.map((rx) => (
        <section key={rx.assignmentId} className="card">
          <div className="card-head">
            <h3 style={{ margin: 0 }}>{rx.exerciseName} <PrescriptionStatusBadge status={rx.status} /></h3>
            <span className="small muted">
              {rx.entriesInPeriod} entr{rx.entriesInPeriod === 1 ? "y" : "ies"}
              {rx.expectedEntriesInPeriod ? ` of ~${rx.expectedEntriesInPeriod} expected (${Math.round(rx.completionRatePct ?? 0)}%)` : ""}
              {rx.latestPain != null ? ` · latest pain ${rx.latestPain}/10` : ""}
            </span>
          </div>
          {rx.attention?.length > 0 && <ul className="attention-list">{rx.attention.map((a) => <li key={a}>{a}</li>)}</ul>}
          {rx.parameters.length === 0 ? <p className="small muted">No targets or measurements for this exercise yet.</p> : (
            <div className="table-wrap">
              <table className="table responsive">
                <thead><tr><th>Measurement</th><th>Baseline</th><th>Target</th><th>Latest</th><th>Remaining</th><th>Progress</th></tr></thead>
                <tbody>
                  {rx.parameters.map((row) => (
                    <tr key={row.parameterId}>
                      <td className="primary">{row.label}{row.targetReached && <> <span className="badge success">Target reached</span></>}</td>
                      <td data-label="Baseline">{row.baseline ? <>{formatMeasured(row.baseline, row.unit)} <SourceBadge source={row.baseline.source} /></> : <span className="muted">—</span>}</td>
                      <td data-label="Target">{row.targetComparable != null ? formatMeasured({ value: row.targetValue, valueMin: row.targetMin, valueMax: row.targetMax }, row.unit) : <span className="muted">—</span>}</td>
                      <td data-label="Latest">{row.latest ? <>{formatMeasured(row.latest, row.unit)} <SourceBadge source={row.latest.source} /></> : <span className="muted">—</span>}</td>
                      <td data-label="Remaining">{row.remaining != null ? formatValue(row.remaining, row.unit) : "—"}</td>
                      <td data-label="Progress">{progressCell(row)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!compact && rx.parameters.filter((r) => r.history.length > 0).map((row) => (
            <div key={row.parameterId} style={{ marginTop: 12 }}>
              <div className="small" style={{ fontWeight: 600 }}>{row.label} over time{row.rangeMeasurement ? " (range span)" : ""}</div>
              <ValueHistoryChart history={row.history} unit={row.unit} label={row.label}
                baseline={row.baseline ? (row.baseline.value ?? (row.baseline.valueMax != null && row.baseline.valueMin != null ? row.baseline.valueMax - row.baseline.valueMin : null)) : null}
                target={row.targetComparable} />
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

/** Read-only list of performance entries with source, flags and therapist feedback. */
export function PerformanceList({ entries, renderActions }) {
  if (!entries?.length) return <EmptyState icon="📝" title="No performance recorded yet" />;
  return (
    <ul className="list">
      {entries.map((e) => (
        <li key={e.id} className="list-item" style={{ alignItems: "flex-start" }}>
          <div className="main">
            <div className="title">
              {e.exerciseName} <SourceBadge source={e.source} />{" "}
              {e.flagged && <span className="badge danger" title={e.flagReason}>Flagged</span>}
            </div>
            <div className="sub">
              {formatDateTime(e.performedAt)}
              {e.repsCompleted != null ? ` · ${e.repsCompleted} reps` : ""}
              {e.setsCompleted != null ? ` · ${e.setsCompleted} set${e.setsCompleted === 1 ? "" : "s"}` : ""}
              {e.durationSeconds != null ? ` · ${e.durationSeconds} s` : ""}
              {e.painLevel != null ? ` · pain ${e.painLevel}/10` : ""}
              {e.difficultyRating != null ? ` · difficulty ${e.difficultyRating}/5` : ""}
              {e.recordedBy && e.source === "THERAPIST_MEASURED" ? ` · by ${e.recordedBy}` : ""}
            </div>
            {e.measurements.length > 0 && (
              <div className="sub">{e.measurements.map((m) => `${m.label}: ${formatMeasured(m)}${m.flagged ? " ⚠" : ""}`).join(" · ")}</div>
            )}
            {e.flagged && e.flagReason && <div className="sub danger-text">{e.flagReason}</div>}
            {e.automated && <div className="sub">Automated camera measurement, not clinically validated.</div>}
            {e.notes && <div className="sub">“{e.notes}”</div>}
            {e.therapistFeedback && (
              <div className="feedback-note"><strong>Physiotherapist feedback{e.feedbackBy ? ` (${e.feedbackBy})` : ""}:</strong> {e.therapistFeedback}</div>
            )}
            {renderActions?.(e)}
          </div>
        </li>
      ))}
    </ul>
  );
}
