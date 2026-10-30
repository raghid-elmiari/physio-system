import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Field } from "../components/ui";
import { validateRegistration } from "../lib/validation";

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", password: "", confirm: "" });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    const v = validateRegistration(form);
    setErrors(v);
    setMessage(null);
    if (Object.keys(v).length) return;
    setBusy(true);
    const { confirm: _confirm, ...body } = form;
    const res = await register(body);
    setBusy(false);
    if (res.ok) navigate("/dashboard", { replace: true });
    else {
      setMessage(res.message);
      setErrors(res.fieldErrors || {});
    }
  }

  const input = (id, type = "text", autoComplete) => (
    <input id={id} className={`input ${errors[id] ? "invalid" : ""}`} type={type} autoComplete={autoComplete} value={form[id]} onChange={set(id)} />
  );

  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">PC</span> PhysioCoach
        </div>
        <h1>Create your account</h1>
        <p className="sub">Patients can register here. Therapist accounts are set up by an administrator.</p>
        <form onSubmit={handleSubmit} noValidate>
          <div className="grid cols-2" style={{ gap: 0, columnGap: 12 }}>
            <Field label="First name" htmlFor="firstName" error={errors.firstName}>{input("firstName", "text", "given-name")}</Field>
            <Field label="Last name" htmlFor="lastName" error={errors.lastName}>{input("lastName", "text", "family-name")}</Field>
          </div>
          <Field label="Email" htmlFor="email" error={errors.email}>{input("email", "email", "email")}</Field>
          <Field label="Password" htmlFor="password" error={errors.password} help="At least 8 characters, with a letter and a number.">
            {input("password", "password", "new-password")}
          </Field>
          <Field label="Confirm password" htmlFor="confirm" error={errors.confirm}>{input("confirm", "password", "new-password")}</Field>
          {message && <div className="alert error" role="alert" style={{ marginBottom: 14 }}>{message}</div>}
          <button type="submit" className="btn block lg" disabled={busy}>
            {busy ? "Creating account…" : "Create account"}
          </button>
        </form>
        <p className="center" style={{ marginTop: 16 }}>
          Already registered? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
