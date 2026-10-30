import { useState } from "react";
import { errorMessage, fieldErrors } from "../api/client";
import { profileApi } from "../api/services";
import { useAuth } from "../context/AuthContext";
import { useApi } from "../lib/useApi";
import { formatDate } from "../lib/format";
import { passwordError } from "../lib/validation";
import { ErrorState, Field, Spinner } from "../components/ui";

export default function Profile() {
  const { updateUser, logout } = useAuth();
  const profile = useApi(() => profileApi.me(), []);
  const [edited, setForm] = useState(null); // null until the user edits: show the loaded values
  const form = edited ?? { firstName: profile.data?.firstName ?? "", lastName: profile.data?.lastName ?? "" };
  const [saveState, setSaveState] = useState({ busy: false, message: null, error: null, fields: {} });
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [pwState, setPwState] = useState({ busy: false, message: null, error: null, fields: {} });

  async function saveProfile(e) {
    e.preventDefault();
    const fields = {};
    if (!form.firstName.trim()) fields.firstName = "First name is required";
    if (!form.lastName.trim()) fields.lastName = "Last name is required";
    if (Object.keys(fields).length) return setSaveState({ busy: false, message: null, error: null, fields });
    setSaveState({ busy: true, message: null, error: null, fields: {} });
    try {
      const updated = await profileApi.update(form);
      updateUser({ firstName: updated.firstName, lastName: updated.lastName });
      setSaveState({ busy: false, message: "Profile saved.", error: null, fields: {} });
    } catch (err) {
      setSaveState({ busy: false, message: null, error: errorMessage(err), fields: fieldErrors(err) });
    }
  }

  async function changePassword(e) {
    e.preventDefault();
    const fields = {};
    if (!pw.currentPassword) fields.currentPassword = "Enter your current password";
    const rule = passwordError(pw.newPassword);
    if (rule) fields.newPassword = rule;
    if (pw.confirm !== pw.newPassword) fields.confirm = "Passwords do not match";
    if (Object.keys(fields).length) return setPwState({ busy: false, message: null, error: null, fields });
    setPwState({ busy: true, message: null, error: null, fields: {} });
    try {
      await profileApi.changePassword(pw.currentPassword, pw.newPassword);
      setPw({ currentPassword: "", newPassword: "", confirm: "" });
      setPwState({ busy: false, message: "Password changed. Other devices have been signed out.", error: null, fields: {} });
    } catch (err) {
      setPwState({ busy: false, message: null, error: errorMessage(err), fields: fieldErrors(err) });
    }
  }

  if (profile.loading) return <main className="page"><Spinner /></main>;
  if (profile.error) return <main className="page"><ErrorState message={profile.error} onRetry={profile.reload} /></main>;
  const p = profile.data;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Profile</h1>
          <p>{p.email} · {p.role.toLowerCase()} · member since {formatDate(p.createdAt)}</p>
        </div>
        <button type="button" className="btn secondary" onClick={logout}>Log out</button>
      </div>
      <div className="grid cols-2">
        <form className="card" onSubmit={saveProfile} noValidate>
          <h2>Personal details</h2>
          <Field label="First name" htmlFor="p-first" error={saveState.fields.firstName}>
            <input id="p-first" className="input" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
          </Field>
          <Field label="Last name" htmlFor="p-last" error={saveState.fields.lastName}>
            <input id="p-last" className="input" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
          </Field>
          <Field label="Email" htmlFor="p-email" help="Contact your clinic to change your email address.">
            <input id="p-email" className="input" value={p.email} disabled />
          </Field>
          {saveState.error && <div className="alert error" style={{ marginBottom: 12 }}>{saveState.error}</div>}
          {saveState.message && <div className="alert success" style={{ marginBottom: 12 }}>{saveState.message}</div>}
          <button type="submit" className="btn" disabled={saveState.busy}>{saveState.busy ? "Saving…" : "Save changes"}</button>
        </form>

        <div className="stack">
          <form className="card" onSubmit={changePassword} noValidate>
            <h2>Change password</h2>
            <Field label="Current password" htmlFor="pw-cur" error={pwState.fields.currentPassword}>
              <input id="pw-cur" type="password" autoComplete="current-password" className="input" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
            </Field>
            <Field label="New password" htmlFor="pw-new" error={pwState.fields.newPassword} help="At least 8 characters, with a letter and a number.">
              <input id="pw-new" type="password" autoComplete="new-password" className="input" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
            </Field>
            <Field label="Confirm new password" htmlFor="pw-conf" error={pwState.fields.confirm}>
              <input id="pw-conf" type="password" autoComplete="new-password" className="input" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
            </Field>
            {pwState.error && <div className="alert error" style={{ marginBottom: 12 }}>{pwState.error}</div>}
            {pwState.message && <div className="alert success" style={{ marginBottom: 12 }}>{pwState.message}</div>}
            <button type="submit" className="btn" disabled={pwState.busy}>{pwState.busy ? "Changing…" : "Change password"}</button>
          </form>
          <section className="card">
            <h2>Your therapist</h2>
            {p.therapist ? (
              <p>{p.therapist.firstName} {p.therapist.lastName} · <a href={`mailto:${p.therapist.email}`}>{p.therapist.email}</a></p>
            ) : (
              <p className="muted">You are not linked to a therapist yet. Your therapist can add you using your email address.</p>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
