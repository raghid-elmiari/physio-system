import { formatDate } from "../lib/format";

/**
 * Accuracy-over-time line chart (pure SVG, no chart library).
 * @param {{points: Array<{date:string, accuracyPct:number|null, exerciseName?:string}>}} props
 */
export default function ProgressChart({ points, height = 200, emptyMessage = "Complete at least two sessions to see your accuracy trend." }) {
  const data = (points || []).filter((p) => p.accuracyPct != null);
  if (data.length < 2) {
    return <p className="muted small">{emptyMessage}</p>;
  }
  const W = 640;
  const H = height;
  const pad = { l: 36, r: 12, t: 12, b: 26 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const x = (i) => pad.l + (data.length === 1 ? iw / 2 : (i / (data.length - 1)) * iw);
  const y = (v) => pad.t + ih - (Math.max(0, Math.min(100, v)) / 100) * ih;
  const line = data.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.accuracyPct).toFixed(1)}`).join(" ");
  const area = `${line} L${x(data.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;
  const labelEvery = Math.ceil(data.length / 5);

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Accuracy over ${data.length} sessions, latest ${Math.round(data[data.length - 1].accuracyPct)}%`}>
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line className="grid-line" x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} />
            <text x={pad.l - 6} y={y(v) + 4} textAnchor="end">{v}%</text>
          </g>
        ))}
        <path className="area" d={area} />
        <path className="line" d={line} />
        {data.map((p, i) => (
          <g key={p.sessionId ?? i}>
            <circle className="dot" cx={x(i)} cy={y(p.accuracyPct)} r={4}>
              <title>{`${formatDate(p.date)} · ${p.exerciseName ?? ""} · ${Math.round(p.accuracyPct)}%`}</title>
            </circle>
            {i % labelEvery === 0 && (
              <text x={x(i)} y={H - 6} textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"}>{formatDate(p.date).replace(/,? \d{4}$/, "")}</text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}
