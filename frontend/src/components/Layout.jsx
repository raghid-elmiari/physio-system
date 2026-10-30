import { useEffect, useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { offlineQueue, syncPendingSessions } from "../platform/sync";

const Icon = {
  home: <path d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  exercises: <path d="M4 10h2v4H4zm14 0h2v4h-2zM6 8h3v8H6zm9 0h3v8h-3zM9 11h6v2H9z" />,
  history: <path d="M12 4a8 8 0 1 1-7.4 5H2l3.5-3.5L9 9H6.7A6 6 0 1 0 12 6zm-1 3h2v5l4 2-1 1.7-5-2.7z" />,
  progress: <path d="M4 19h16v2H4zM5 15l4-4 3 3 6-6 1.4 1.4L12 16.8l-3-3-2.6 2.6z" />,
  patients: <path d="M9 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm-7 9a7 7 0 0 1 14 0zm15-9a3 3 0 1 0 0-6v2a1 1 0 1 1 0 2zm1.5 9H22a5 5 0 0 0-4-4.9 8.9 8.9 0 0 1 .5 4.9z" />,
  profile: <path d="M12 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm-9 10a9 9 0 0 1 18 0z" />,
};

function NavIcon({ name }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {Icon[name]}
    </svg>
  );
}

const PATIENT_NAV = [
  { to: "/dashboard", label: "Home", icon: "home" },
  { to: "/exercises", label: "Exercises", icon: "exercises" },
  { to: "/history", label: "History", icon: "history" },
  { to: "/progress", label: "Progress", icon: "progress" },
  { to: "/profile", label: "Profile", icon: "profile" },
];

const STAFF_NAV = [
  { to: "/dashboard", label: "Dashboard", icon: "home" },
  { to: "/patients", label: "Patients", icon: "patients" },
  { to: "/exercises", label: "Exercises", icon: "exercises" },
  { to: "/profile", label: "Profile", icon: "profile" },
];

function navItems(role) {
  return role === "THERAPIST" || role === "ADMIN" ? STAFF_NAV : PATIENT_NAV;
}

/** Upload sessions recorded offline whenever we come back online. */
function useBackgroundSync() {
  const [pending, setPending] = useState(offlineQueue.size());
  useEffect(() => {
    const run = () => syncPendingSessions().then((r) => setPending(r.remaining)).catch(() => setPending(offlineQueue.size()));
    run();
    window.addEventListener("online", run);
    const timer = setInterval(run, 60000);
    return () => {
      window.removeEventListener("online", run);
      clearInterval(timer);
    };
  }, []);
  return pending;
}

export default function Layout() {
  const { user, logout } = useAuth();
  const pending = useBackgroundSync();
  const items = navItems(user?.role);

  return (
    <>
      <header className="app-header no-print">
        <Link to="/dashboard" className="brand">
          <span className="brand-mark" aria-hidden="true">PC</span>
          <span>PhysioCoach</span>
        </Link>
        <nav className="top-nav" aria-label="Main">
          {items.filter((i) => i.to !== "/profile").map((i) => (
            <NavLink key={i.to} to={i.to}>
              {i.label}
            </NavLink>
          ))}
        </nav>
        <div className="header-user">
          {pending > 0 && <span className="badge warning" title="Sessions waiting to upload">{pending} unsynced</span>}
          <NavLink to="/profile" className="name">
            {user?.firstName}
          </NavLink>
          <button type="button" className="btn ghost sm" onClick={logout}>
            Log out
          </button>
        </div>
      </header>
      <Outlet />
      <nav className="bottom-nav no-print" aria-label="Main">
        {items.map((i) => (
          <NavLink key={i.to} to={i.to}>
            <NavIcon name={i.icon} />
            {i.label}
          </NavLink>
        ))}
      </nav>
    </>
  );
}
