import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { errorMessage } from "../api/client";
import { notificationsApi } from "../api/services";
import { useApi } from "../lib/useApi";
import { formatDateTime } from "../lib/format";
import { EmptyState, ErrorState, Spinner } from "../components/ui";

/** Allows only in-app routes from notification links (they are created by the backend). */
const safeLink = (link) => (typeof link === "string" && link.startsWith("/") && !link.startsWith("//") ? link : null);

export default function Notifications() {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const list = useApi(() => notificationsApi.list(unreadOnly), [unreadOnly]);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  const changed = () => {
    list.reload();
    window.dispatchEvent(new Event("notifications-changed"));
  };

  async function act(fn) {
    setError(null);
    try {
      await fn();
      changed();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function open(n) {
    const link = safeLink(n.link);
    if (!n.read) await notificationsApi.markRead(n.id, true).catch(() => {});
    window.dispatchEvent(new Event("notifications-changed"));
    if (link) navigate(link);
    else list.reload();
  }

  const items = list.data || [];
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Notifications</h1>
          <p>Updates about assessments, prescriptions, feedback and video suggestions.</p>
        </div>
        <div className="row">
          <div className="segmented" role="group" aria-label="Filter">
            <button type="button" className={!unreadOnly ? "active" : ""} onClick={() => setUnreadOnly(false)}>All</button>
            <button type="button" className={unreadOnly ? "active" : ""} onClick={() => setUnreadOnly(true)}>Unread</button>
          </div>
          <button type="button" className="btn secondary sm" disabled={!items.some((n) => !n.read)} onClick={() => act(() => notificationsApi.markAllRead())}>
            Mark all as read
          </button>
        </div>
      </div>
      {error && <div className="alert error" style={{ marginBottom: 12 }}>{error}</div>}
      <section className="card">
        {list.loading && <Spinner />}
        {list.error && <ErrorState message={list.error} onRetry={list.reload} />}
        {list.data && items.length === 0 && <EmptyState icon="🔔" title={unreadOnly ? "No unread notifications" : "No notifications yet"} />}
        {items.map((n) => (
          <div key={n.id} className={`notification ${n.read ? "" : "unread"}`}>
            <div className="main">
              <div className="title">{safeLink(n.link) ? <Link to={safeLink(n.link)} onClick={(e) => { e.preventDefault(); open(n); }}>{n.title}</Link> : n.title}</div>
              {n.message && <div className="message">{n.message}</div>}
              <div className="small muted">{formatDateTime(n.createdAt)}</div>
            </div>
            <button type="button" className="btn ghost sm" onClick={() => act(() => notificationsApi.markRead(n.id, !n.read))}>
              {n.read ? "Mark unread" : "Mark read"}
            </button>
          </div>
        ))}
      </section>
    </main>
  );
}
