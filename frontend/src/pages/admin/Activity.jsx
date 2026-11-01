import { useState } from "react";
import { adminApi } from "../../api/services";
import { useApi } from "../../lib/useApi";
import { formatDateTime } from "../../lib/format";
import { ROLE_LABELS } from "../../lib/clinicalLabels";
import { EmptyState, ErrorState, Spinner } from "../../components/ui";

const ENTITY_TYPES = [
  ["", "Everything"], ["USER", "Users & assignments"], ["ASSESSMENT", "Assessments"], ["PRESCRIPTION", "Prescriptions"],
  ["PERFORMANCE", "Performance"], ["VIDEO_SUBMISSION", "Video suggestions"], ["VIDEO", "Library videos"],
  ["VIDEO_RESOURCE", "Patient videos"], ["EXERCISE", "Exercise library"], ["REPORT", "Reports"],
];
const PAGE_SIZE = 30;

export default function Activity() {
  const [entityType, setEntityType] = useState("");
  const [page, setPage] = useState(0);
  const log = useApi(() => adminApi.auditLog({ entityType, page, size: PAGE_SIZE }), [entityType, page]);
  const total = log.data?.total ?? 0;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Activity log</h1>
          <p>Every important clinical and administrative change, with who made it. Entries cannot be edited or deleted.</p>
        </div>
        <label className="inline-field">Show
          <select className="input" value={entityType} onChange={(e) => { setEntityType(e.target.value); setPage(0); }}>
            {ENTITY_TYPES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      </div>
      <section className="card">
        {log.loading && <Spinner />}
        {log.error && <ErrorState message={log.error} onRetry={log.reload} />}
        {log.data?.entries.length === 0 && <EmptyState icon="🗂" title="No activity recorded" />}
        <ul className="list">
          {(log.data?.entries || []).map((e) => (
            <li key={e.id} className="list-item" style={{ alignItems: "flex-start" }}>
              <div className="main">
                <div className="title small">{e.summary}</div>
                <div className="sub">
                  {e.actorName}{e.actorRole ? ` (${ROLE_LABELS[e.actorRole] ?? e.actorRole})` : ""} · {formatDateTime(e.createdAt)}
                  {e.patientName ? ` · patient ${e.patientName}` : ""}
                </div>
                {e.details && <details className="panel small"><summary>Details</summary><pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{JSON.stringify(e.details, null, 2)}</pre></details>}
              </div>
              <span className="badge">{e.action.replaceAll("_", " ").toLowerCase()}</span>
            </li>
          ))}
        </ul>
        {total > PAGE_SIZE && (
          <div className="row" style={{ marginTop: 12 }}>
            <button type="button" className="btn secondary sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Newer</button>
            <span className="small muted">Page {page + 1} of {Math.ceil(total / PAGE_SIZE)}</span>
            <button type="button" className="btn secondary sm" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage(page + 1)}>Older</button>
          </div>
        )}
      </section>
    </main>
  );
}
