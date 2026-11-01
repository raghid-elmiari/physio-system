import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { errorMessage, fieldErrors } from "../../api/client";
import { adminApi } from "../../api/services";
import { useAuth } from "../../context/AuthContext";
import { useApi } from "../../lib/useApi";
import { formatDate } from "../../lib/format";
import { ROLE_LABELS } from "../../lib/clinicalLabels";
import { EmptyState, ErrorState, Field, Spinner } from "../../components/ui";

export default function Users() {
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useState({ role: "", status: "", search: "" });
  const users = useApi(() => adminApi.users(filters), [filters.role, filters.status, filters.search]);
  const therapists = useApi(() => adminApi.users({ role: "THERAPIST", status: "ACTIVE" }), []);
  const permissions = useApi(() => adminApi.permissions(), []);
  const [message, setMessage] = useState(null);
  const { user: me } = useAuth();
  const showCreate = params.get("add") === "1";

  async function run(action, success) {
    setMessage(null);
    try {
      await action();
      setMessage({ tone: "success", text: success });
      users.reload();
    } catch (err) {
      setMessage({ tone: "error", text: errorMessage(err) });
    }
  }

  function changeRole(u, role) {
    if (role === u.role) return;
    const reason = window.prompt(`Change ${u.firstName} ${u.lastName} from ${ROLE_LABELS[u.role]} to ${ROLE_LABELS[role]}?\nThey will be signed out on all devices.\n\nReason (optional):`, "");
    if (reason === null) return users.reload();
    run(() => adminApi.changeRole(u.id, role, reason || null), `${u.firstName} is now ${ROLE_LABELS[role]}.`);
  }

  function toggleStatus(u) {
    const to = u.status === "ACTIVE" ? "DISABLED" : "ACTIVE";
    const question = to === "DISABLED"
      ? `Deactivate ${u.firstName} ${u.lastName}? They are signed out at once and cannot sign in. Their records are kept.`
      : `Reactivate ${u.firstName} ${u.lastName}?`;
    if (!window.confirm(question)) return;
    run(() => adminApi.changeStatus(u.id, to, null), to === "DISABLED" ? "Account deactivated." : "Account reactivated.");
  }

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Users</h1>
          <p>Create accounts, change roles and control access. Accounts are deactivated, never deleted.</p>
        </div>
        {!showCreate && <button type="button" className="btn" onClick={() => setParams({ add: "1" })}>Create user</button>}
      </div>
      <div className="stack">
        {showCreate && (
          <CreateUserForm therapists={therapists.data || []} onCancel={() => setParams({})}
            onCreated={(u) => { setParams({}); setMessage({ tone: "success", text: `Created ${ROLE_LABELS[u.role]} account for ${u.firstName} ${u.lastName}.` }); users.reload(); }} />
        )}
        {message && <div className={`alert ${message.tone}`}>{message.text}</div>}
        <section className="card">
          <div className="filters">
            <input className="input" type="search" placeholder="Search name, email or #ID" aria-label="Search users" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
            <label className="inline-field">Role
              <select className="input" value={filters.role} onChange={(e) => setFilters({ ...filters, role: e.target.value })}>
                <option value="">All roles</option>
                {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="inline-field">Status
              <select className="input" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
                <option value="">Any</option>
                <option value="ACTIVE">Active</option>
                <option value="DISABLED">Deactivated</option>
              </select>
            </label>
          </div>
          {users.loading && <Spinner />}
          {users.error && <ErrorState message={users.error} onRetry={users.reload} />}
          {users.data?.length === 0 && <EmptyState title="No users match" />}
          {users.data?.length > 0 && (
            <div className="table-wrap">
              <table className="table responsive">
                <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Therapist / patients</th><th>Status</th><th>Created</th><th /></tr></thead>
                <tbody>
                  {users.data.map((u) => {
                    const self = u.id === me?.id;
                    return (
                      <tr key={u.id}>
                        <td className="primary">{u.firstName} {u.lastName} <span className="muted small">#{u.id}</span>{self && <span className="badge" style={{ marginLeft: 6 }}>You</span>}</td>
                        <td data-label="Email">{u.email}</td>
                        <td data-label="Role">
                          <select className="input" style={{ minHeight: 34, padding: "4px 8px" }} aria-label={`Role of ${u.firstName} ${u.lastName}`} value={u.role} disabled={self} onChange={(e) => changeRole(u, e.target.value)}>
                            {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                          </select>
                        </td>
                        <td data-label="Assignment">{u.role === "PATIENT" ? (u.therapistName ?? <span className="badge warning">Unassigned</span>) : u.role === "THERAPIST" ? `${u.patientCount} patient(s)` : "—"}</td>
                        <td data-label="Status"><span className={`badge ${u.status === "ACTIVE" ? "success" : "danger"}`}>{u.status === "ACTIVE" ? "Active" : "Deactivated"}</span></td>
                        <td data-label="Created">{formatDate(u.createdAt)}</td>
                        <td>
                          <button type="button" className={`btn sm ${u.status === "ACTIVE" ? "ghost danger-text" : "secondary"}`} disabled={self} onClick={() => toggleStatus(u)}>
                            {u.status === "ACTIVE" ? "Deactivate" : "Reactivate"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className="card">
          <h2>Roles and permissions</h2>
          <p className="small muted">Roles are fixed and enforced by the server on every request. Clinical decisions always belong to the patient&apos;s assigned physiotherapist.</p>
          {permissions.data && (
            <div className="permission-grid">
              {permissions.data.map((r) => (
                <div key={r.role}>
                  <h3>{ROLE_LABELS[r.role]}</h3>
                  <p className="small muted">{r.description}</p>
                  <ul>{r.allowed.map((a) => <li key={a}>{a}</li>)}</ul>
                  {r.denied.length > 0 && <><p className="small" style={{ margin: "8px 0 4px", fontWeight: 600 }}>Never allowed</p><ul className="denied">{r.denied.map((a) => <li key={a}>{a}</li>)}</ul></>}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function CreateUserForm({ therapists, onCreated, onCancel }) {
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", temporaryPassword: "", role: "PATIENT", therapistId: "" });
  const [state, setState] = useState({ busy: false, error: null, fields: {} });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    const fields = {};
    if (!form.firstName.trim()) fields.firstName = "Required";
    if (!form.lastName.trim()) fields.lastName = "Required";
    if (!/^\S+@\S+\.\S+$/.test(form.email)) fields.email = "Enter a valid email";
    if (!/^(?=.*[A-Za-z])(?=.*\d).{8,72}$/.test(form.temporaryPassword)) fields.temporaryPassword = "8+ characters with a letter and a number";
    if (Object.keys(fields).length) return setState({ busy: false, error: null, fields });
    setState({ busy: true, error: null, fields: {} });
    try {
      const created = await adminApi.createUser({ ...form, therapistId: form.role === "PATIENT" && form.therapistId ? Number(form.therapistId) : null });
      onCreated(created);
    } catch (err) {
      setState({ busy: false, error: errorMessage(err), fields: fieldErrors(err) });
    }
  }

  return (
    <form className="card" onSubmit={submit} noValidate>
      <h2>Create user</h2>
      <div className="grid cols-3" style={{ gap: 0, columnGap: 12 }}>
        <Field label="First name" htmlFor="u-first" error={state.fields.firstName}><input id="u-first" className="input" value={form.firstName} onChange={set("firstName")} /></Field>
        <Field label="Last name" htmlFor="u-last" error={state.fields.lastName}><input id="u-last" className="input" value={form.lastName} onChange={set("lastName")} /></Field>
        <Field label="Email" htmlFor="u-email" error={state.fields.email}><input id="u-email" type="email" className="input" autoComplete="off" value={form.email} onChange={set("email")} /></Field>
        <Field label="Temporary password" htmlFor="u-pw" error={state.fields.temporaryPassword} help="Share it securely; they can change it in Profile."><input id="u-pw" type="text" className="input" autoComplete="new-password" value={form.temporaryPassword} onChange={set("temporaryPassword")} /></Field>
        <Field label="Role" htmlFor="u-role" error={state.fields.role}>
          <select id="u-role" className="input" value={form.role} onChange={set("role")}>
            {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        {form.role === "PATIENT" && (
          <Field label="Physiotherapist" htmlFor="u-ther" help="Optional; can be assigned later.">
            <select id="u-ther" className="input" value={form.therapistId} onChange={set("therapistId")}>
              <option value="">Not assigned yet</option>
              {therapists.map((t) => <option key={t.id} value={t.id}>{t.firstName} {t.lastName}</option>)}
            </select>
          </Field>
        )}
      </div>
      {state.error && <div className="alert error" style={{ marginBottom: 12 }}>{state.error}</div>}
      <div className="row">
        <button type="submit" className="btn" disabled={state.busy}>{state.busy ? "Creating…" : "Create account"}</button>
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
