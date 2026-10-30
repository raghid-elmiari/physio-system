import { useState } from "react";
import { therapistApi } from "../../api/services";
import { useApi } from "../../lib/useApi";
import { lastDaysRange } from "../../lib/format";
import { ErrorState, Spinner } from "../../components/ui";
import MeasurementsView from "../reports/MeasurementsView";
import DateRangePicker from "./DateRangePicker";

/** Live performance review for any date range, from the sessions recorded by the camera coach. */
export default function PerformancePanel({ patientId }) {
  const [range, setRange] = useState(() => lastDaysRange(30));
  const validRange = range.from && range.to && range.from <= range.to;
  const performance = useApi(
    () => (validRange ? therapistApi.performance(patientId, range.from, range.to) : Promise.resolve(null)),
    [patientId, range.from, range.to]
  );

  return (
    <div className="stack">
      <section className="card">
        <DateRangePicker value={range} onChange={setRange} idPrefix="perf" />
        {!validRange && <p className="small" style={{ color: "var(--danger)" }}>Choose a start date on or before the end date.</p>}
      </section>
      {performance.loading && <Spinner label="Loading performance…" />}
      {performance.error && <ErrorState message={performance.error} onRetry={performance.reload} />}
      {performance.data && <MeasurementsView measurements={performance.data} />}
    </div>
  );
}
