import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Field } from "../components/ui";
import { EMAIL_RE } from "../lib/validation";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: "", password: "" });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    const v = {};
    if (!EMAIL_RE.test(form.email.trim())) v.email = "Enter a valid email address";
    if (!form.password) v.password = "Enter your password";
    setErrors(v);
    setMessage(null);
    if (Object.keys(v).length) return;
    setBusy(true);
    const res = await login(form.email, form.password);
    setBusy(false);
    if (res.ok) navigate(location.state?.from || "/dashboard", { replace: true });
    else {
      setMessage(res.message);
      setErrors(res.fieldErrors || {});
    }
  }

  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">PC</span> PhysioCoach
        </div>
        <h1>Sign in</h1>
        <p className="sub">Your rehabilitation exercises, with a coach that watches and talks you through them.</p>
        <form onSubmit={handleSubmit} noValidate>
          <Field label="Email" htmlFor="email" error={errors.email}>
            <input id="email" className={`input ${errors.email ? "invalid" : ""}`} type="email" autoComplete="email" value={form.email} onChange={set("email")} />
          </Field>
          <Field label="Password" htmlFor="password" error={errors.password}>
            <input id="password" className={`input ${errors.password ? "invalid" : ""}`} type="password" autoComplete="current-password" value={form.password} onChange={set("password")} />
          </Field>
          {message && <div className="alert error" role="alert" style={{ marginBottom: 14 }}>{message}</div>}
          <button type="submit" className="btn block lg" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="center" style={{ marginTop: 16 }}>
          No account? <Link to="/register">Create one</Link>
        </p>
        <p className="demo-hint">Local demo accounts (when SEED_DEMO_DATA=true): patient@demo.local / therapist@demo.local, password from DEMO_USER_PASSWORD in backend/.env.</p>
      </div>
    </div>
  );
}
