// Small presentational building blocks shared by every page.

export function Spinner({ label = "Loading…" }) {
  return (
    <div className="loading-block" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="alert error" role="alert">
      <div className="row">
        <span className="spacer">{message}</span>
        {onRetry && (
          <button type="button" className="btn sm secondary" onClick={onRetry}>
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

export function EmptyState({ icon = "○", title, children }) {
  return (
    <div className="empty">
      <div className="icon" aria-hidden="true">{icon}</div>
      {title && <h3>{title}</h3>}
      {children && <div className="small">{children}</div>}
    </div>
  );
}

export function StatTile({ label, value, hint }) {
  return (
    <div className="card stat">
      <span className="label">{label}</span>
      <span className="value">{value ?? "—"}</span>
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function Field({ label, error, help, children, htmlFor }) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {help && !error && <span className="help">{help}</span>}
      {error && <span className="error" role="alert">{error}</span>}
    </div>
  );
}

const STATUS_BADGE = {
  COMPLETED: "success",
  IN_PROGRESS: "primary",
  ABORTED: "warning",
};

export function StatusBadge({ status }) {
  const label = { COMPLETED: "Completed", IN_PROGRESS: "In progress", ABORTED: "Interrupted" }[status] || status;
  return <span className={`badge ${STATUS_BADGE[status] || ""}`}>{label}</span>;
}

export function AccuracyBadge({ value }) {
  if (value == null || value === "") return <span className="badge">—</span>;
  const n = Number(value);
  const tone = n >= 80 ? "success" : n >= 50 ? "warning" : "danger";
  return <span className={`badge ${tone}`}>{Math.round(n)}% correct</span>;
}
