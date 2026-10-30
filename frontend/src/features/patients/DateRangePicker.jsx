import { lastDaysRange, toIsoDate } from "../../lib/format";

const RANGE_PRESETS = [
  [7, "Last 7 days"],
  [14, "Last 2 weeks"],
  [30, "Last 30 days"],
  [90, "Last 3 months"],
];

/** From/to date inputs with quick presets. Dates are yyyy-mm-dd strings. */
export default function DateRangePicker({ value, onChange, idPrefix = "range" }) {
  const today = toIsoDate(new Date());
  return (
    <div className="filters">
      <label className="inline-field" htmlFor={`${idPrefix}-from`}>
        From
        <input id={`${idPrefix}-from`} type="date" className="input" max={value.to || today} value={value.from}
          onChange={(e) => onChange({ ...value, from: e.target.value })} />
      </label>
      <label className="inline-field" htmlFor={`${idPrefix}-to`}>
        To
        <input id={`${idPrefix}-to`} type="date" className="input" min={value.from} max={today} value={value.to}
          onChange={(e) => onChange({ ...value, to: e.target.value })} />
      </label>
      <div className="row">
        {RANGE_PRESETS.map(([days, label]) => (
          <button key={days} type="button" className="btn ghost sm" onClick={() => onChange(lastDaysRange(days))}>{label}</button>
        ))}
      </div>
    </div>
  );
}
