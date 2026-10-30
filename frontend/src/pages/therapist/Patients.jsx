import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { errorMessage, fieldErrors } from "../../api/client";
import { therapistApi } from "../../api/services";
import { useApi } from "../../lib/useApi";
import { relativeDay } from "../../lib/format";
import { EMAIL_RE, passwordError } from "../../lib/validation";
import { REHAB_STATUS_LABELS, REHAB_STATUS_TONES } from "../../lib/clinicalLabels";
import { EmptyState, ErrorState, Field, Spinner } from "../../components/ui";

const EMPTY_NEW_PATIENT = {
  firstName: "", lastName: "", email: "", temporaryPassword: "",
  phone: "", dateOfBirth: "", primaryCondition: "", rehabStatus: "ASSESSMENT",
};

export default function Patients() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchInput, setSearchInput] = useState(searchParams.get("search") ?? "");
  const filters = {
    search: searchParams.get("search") ?? "",
    rehabStatus: searchParams.get("rehabStatus") ?? "",
    accountStatus: searchParams.get("accountStatus") ?? "",
  };
  const patients = useApi(() => therapistApi.patients(filters), [filters.search, filters.rehabStatus, filters.accountStatus]);
  const addMode = searchParams.get("add"); // "new" | "link" | null

  // Debounce the search box into the URL so the list (and browser history) follow it.
  useEffect(() => {
    if (searchInput.trim() === (new URLSearchParams(window.location.search).get("search") ?? "")) return undefined;
    const timer = setTimeout(() => updateParam("search", searchInput.trim()), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  // Reads the live URL rather than the render-time searchParams, so a delayed update (the
  // debounced search) never undoes a parameter changed in the meantime (e.g. "add").
  function updateParam(key, value) {
    const next = new URLSearchParams(window.location.search);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  }

  const filtered = filters.search || filters.rehabStatus || filters.accountStatus;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Patients</h1>
          <p>Manage your patients, their exercise programs and reports.</p>
        </div>
        <div className="row">
          <button type="button" className="btn secondary" onClick={() => updateParam("add", addMode === "link" ? "" : "link")}>Link existing account</button>
          <button type="button" className="btn" onClick={() => updateParam("add", addMode === "new" ? "" : "new")}>Add new patient</button>
        </div>
      </div>

      <div className="stack">
        {addMode === "new" && <NewPatientForm onDone={() => { updateParam("add", ""); patients.reload(); }} />}
        {addMode === "link" && <LinkPatientForm onDone={() => { updateParam("add", ""); patients.reload(); }} />}

        <section className="card">
          <div className="filters">
            <input
              className="input"
              type="search"
              placeholder="Search by name, email or patient ID"
              aria-label="Search patients"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            <select className="input" aria-label="Rehabilitation status" value={filters.rehabStatus} onChange={(e) => updateParam("rehabStatus", e.target.value)}>
              <option value="">All rehabilitation statuses</option>
              {Object.entries(REHAB_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <select className="input" aria-label="Account status" value={filters.accountStatus} onChange={(e) => updateParam("accountStatus", e.target.value)}>
              <option value="">Active and deactivated</option>
              <option value="ACTIVE">Active accounts</option>
              <option value="DISABLED">Deactivated accounts</option>
            </select>
          </div>

          {patients.loading && <Spinner />}
          {patients.error && <ErrorState message={patients.error} onRetry={patients.reload} />}
          {patients.data?.length === 0 && (
            <EmptyState icon="👥" title={filtered ? "No matching patients" : "No patients yet"}>
              {filtered ? "Try a different search or filter." : "Add a new patient or link one who has already registered."}
            </EmptyState>
          )}
          {patients.data?.length > 0 && (
            <div className="table-wrap">
              <table className="table responsive">
                <thead>
                  <tr><th>Patient</th><th>ID</th><th>Condition</th><th>Status</th><th>Program</th><th>Last session</th></tr>
                </thead>
                <tbody>
                  {patients.data.map((patient) => (
                    <tr key={patient.id}>
                      <td className="primary">
                        <Link to={`/patients/${patient.id}`}><strong>{patient.firstName} {patient.lastName}</strong></Link>
                        <div className="small muted">{patient.email}</div>
                      </td>
                      <td data-label="ID">#{patient.id}</td>
                      <td data-label="Condition">{patient.primaryCondition || <span className="muted">—</span>}</td>
                      <td data-label="Status">
                        <span className={`badge ${REHAB_STATUS_TONES[patient.rehabStatus] ?? ""}`}>{REHAB_STATUS_LABELS[patient.rehabStatus] ?? "Not set"}</span>{" "}
                        {patient.accountStatus === "DISABLED" && <span className="badge danger">Deactivated</span>}
                      </td>
                      <td data-label="Program">{patient.activeAssignments} exercise{patient.activeAssignments === 1 ? "" : "s"}</td>
                      <td data-label="Last session">{relativeDay(patient.lastSessionAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function NewPatientForm({ onDone }) {
  const [form, setForm] = useState(EMPTY_NEW_PATIENT);
  const [state, setState] = useState({ busy: false, error: null, fields: {}, created: null });
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  function validate() {
    const fields = {};
    if (!form.firstName.trim()) fields.firstName = "First name is required";
    if (!form.lastName.trim()) fields.lastName = "Last name is required";
    if (!EMAIL_RE.test(form.email.trim())) fields.email = "Enter a valid email address";
    const pw = passwordError(form.temporaryPassword);
    if (pw) fields.temporaryPassword = pw;
    return fields;
  }

  async function handleCreatePatient(e) {
    e.preventDefault();
    const fields = validate();
    if (Object.keys(fields).length) return setState({ busy: false, error: null, fields, created: null });
    setState({ busy: true, error: null, fields: {}, created: null });
    try {
      const created = await therapistApi.createPatient({
        ...form,
        email: form.email.trim(),
        phone: form.phone.trim() || null,
        dateOfBirth: form.dateOfBirth || null,
        primaryCondition: form.primaryCondition.trim() || null,
      });
      setForm(EMPTY_NEW_PATIENT);
      setState({ busy: false, error: null, fields: {}, created });
    } catch (err) {
      setState({ busy: false, error: errorMessage(err), fields: fieldErrors(err), created: null });
    }
  }

  if (state.created) {
    const p = state.created;
    return (
      <section className="card">
        <div className="alert success">
          Account created for <strong>{p.firstName} {p.lastName}</strong>. Give them their email ({p.email}) and the temporary
          password you chose; they can change it under Profile after signing in.
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <Link className="btn" to={`/patients/${p.id}?tab=program`}>Assign exercises</Link>
          <button type="button" className="btn secondary" onClick={onDone}>Close</button>
        </div>
      </section>
    );
  }

  return (
    <form className="card" onSubmit={handleCreatePatient} noValidate>
      <h2>Add a new patient</h2>
      <div className="grid cols-2" style={{ gap: 0, columnGap: 14 }}>
        <Field label="First name" htmlFor="np-first" error={state.fields.firstName}><input id="np-first" className="input" value={form.firstName} onChange={set("firstName")} /></Field>
        <Field label="Last name" htmlFor="np-last" error={state.fields.lastName}><input id="np-last" className="input" value={form.lastName} onChange={set("lastName")} /></Field>
        <Field label="Email" htmlFor="np-email" error={state.fields.email}><input id="np-email" className="input" type="email" value={form.email} onChange={set("email")} /></Field>
        <Field label="Temporary password" htmlFor="np-pw" error={state.fields.temporaryPassword} help="At least 8 characters with a letter and a number.">
          <input id="np-pw" className="input" type="text" autoComplete="off" value={form.temporaryPassword} onChange={set("temporaryPassword")} />
        </Field>
        <Field label="Phone (optional)" htmlFor="np-phone" error={state.fields.phone}><input id="np-phone" className="input" type="tel" value={form.phone} onChange={set("phone")} /></Field>
        <Field label="Date of birth (optional)" htmlFor="np-dob" error={state.fields.dateOfBirth}><input id="np-dob" className="input" type="date" value={form.dateOfBirth} onChange={set("dateOfBirth")} /></Field>
        <Field label="Primary condition (optional)" htmlFor="np-cond" error={state.fields.primaryCondition}><input id="np-cond" className="input" maxLength={255} value={form.primaryCondition} onChange={set("primaryCondition")} /></Field>
        <Field label="Rehabilitation status" htmlFor="np-status" error={state.fields.rehabStatus}>
          <select id="np-status" className="input" value={form.rehabStatus} onChange={set("rehabStatus")}>
            {Object.entries(REHAB_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
      </div>
      {state.error && <div className="alert error" style={{ marginBottom: 12 }}>{state.error}</div>}
      <div className="row">
        <button type="submit" className="btn" disabled={state.busy}>{state.busy ? "Creating…" : "Create patient account"}</button>
        <button type="button" className="btn ghost" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

function LinkPatientForm({ onDone }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState({ busy: false, error: null });

  async function handleLinkPatient(e) {
    e.preventDefault();
    if (!EMAIL_RE.test(email.trim())) return setState({ busy: false, error: "Enter the patient's email address" });
    setState({ busy: true, error: null });
    try {
      await therapistApi.linkPatient(email.trim());
      onDone();
    } catch (err) {
      setState({ busy: false, error: errorMessage(err) });
    }
  }

  return (
    <form className="card" onSubmit={handleLinkPatient} noValidate>
      <h2>Link an existing patient account</h2>
      <Field label="Patient email" htmlFor="link-email" error={state.error} help="For patients who registered themselves in the app.">
        <input id="link-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <div className="row">
        <button type="submit" className="btn" disabled={state.busy}>{state.busy ? "Linking…" : "Link patient"}</button>
        <button type="button" className="btn ghost" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}
