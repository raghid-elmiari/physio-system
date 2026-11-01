import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { notificationsApi } from "../api/services";

const POLL_MS = 60000;

/** Header bell with the unread count; refreshes every minute, on focus and on navigation. */
export default function NotificationBell() {
  const [unread, setUnread] = useState(0);
  const location = useLocation();

  useEffect(() => {
    let cancelled = false;
    const load = () => notificationsApi.unreadCount().then((r) => !cancelled && setUnread(r.unread)).catch(() => {});
    load();
    const timer = setInterval(load, POLL_MS);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    window.addEventListener("notifications-changed", onFocus);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("notifications-changed", onFocus);
    };
  }, [location.pathname]);

  return (
    <Link to="/notifications" className="bell" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}>
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 22a2.5 2.5 0 0 0 2.4-2h-4.8a2.5 2.5 0 0 0 2.4 2zm7-6V11a7 7 0 0 0-5.5-6.8V3a1.5 1.5 0 0 0-3 0v1.2A7 7 0 0 0 5 11v5l-2 2v1h18v-1z" />
      </svg>
      {unread > 0 && <span className="bell-count">{unread > 99 ? "99+" : unread}</span>}
    </Link>
  );
}
