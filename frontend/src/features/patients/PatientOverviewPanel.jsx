import { useState } from "react";
import { Link } from "react-router-dom";
import { errorMessage, fieldErrors } from "../../api/client";
import { therapistApi } from "../../api/services";
import { useApi } from "../../lib/useApi";
import { formatCalendarDate, formatDateTime, sessionAccuracy } from "../../lib/format";
import { REHAB_STATUS_LABELS } from "../../lib/clinicalLabels";
import { AccuracyBadge, ErrorState, Field, Spinner, StatusBadge } from "../../components/ui";

/** Profile details, account status, recent sessions and clinical notes for one patient. */
export default function PatientOverviewPanel({ patient, onPatientChanged }) {
  return (
    <div className="grid cols-2" style={{ alignItems: "start" }}>
      <div className="stack">
        <PatientDetailsCard patient={patient} onSaved={onPatientChanged} />
        <AccountStatusCard patient={patient} onChanged={onPatientChanged} />
      </div>
      <div className="stack">
        <RecentSessionsCard patientId={patient.id} />
        <ClinicalNotesCard patientId={patient.id} />
      </div>
    </div>
  );
}

function detailsFormFrom(patient) {
  return {
    firstName: patient.firstName,
    lastName: patient.lastName,
    phone: patient.phone ?? "",
    dateOfBirth: patient.dateOfBirth ?? "",
    primaryCondition: patient.primaryCondition ?? "",
    rehabStatus: patient.rehabStatus ?? "IN_TREATMENT",
  };
}

function PatientDetailsCard({ patient, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(() => detailsFormFrom(patient));
  const [state, setState] = useState({ busy: false, error: null, fields: {} });
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  function startEditing() {
    setForm(detailsFormFrom(patient));
    setState({ busy: false, error: null, fields: {} });
    setEditing(true);
  }

  async function handleSavePatientDetails(e) {
    e.preventDefault();
    const fields = {};
    if (!form.firstName.trim()) fields.firstName = "First name is required";
    if (!form.lastName.trim()) fields.lastName = "Last name is required";
    if (Object.keys(fields).length) return setState({ busy: false, error: null, fields });
    setState({ busy: true, error: null, fields: {} });
    try {
      await therapistApi.updatePatient(patient.id, {
        ...form,
        phone: form.phone.trim() || null,
        dateOfBirth: form.dateOfBirth || null,
        primaryCondition: form.primaryCondition.trim() || null,
      });
      setEditing(false);
      setState({ busy: false, error: null, fields: {} });
      onSaved();
    } catch (err) {
      setState({ busy: false, error: errorMessage(err), fields: fieldErrors(err) });
    }
  }

  if (!editing) {
    return (
      <section className="card">
        <div className="card-head">
          <h2>Patient details</h2>
          <button type="button" className="btn secondary sm" onClick={startEditing}>Edit</button>
        </div>
        <dl className="details">
          <dt>Email</dt><dd>{patient.email}</dd>
          <dt>Phone</dt><dd>{patient.phone || "—"}</dd>
          <dt>Date of birth</dt><dd>{patient.dateOfBirth ? formatCalendarDate(patient.dateOfBirth) : "—"}</dd>
          <dt>Primary condition</dt><dd>{patient.primaryCondition || "—"}</dd>
          <dt>Rehabilitation status</dt><dd>{REHAB_STATUS_LABELS[patient.rehabStatus] ?? "Not set"}</dd>
          <dt>Registered</dt><dd>{formatDateTime(patient.registeredAt)}</dd>
        </dl>
      </section>
    );
  }

  return (
    <form className="card" onSubmit={handleSavePatientDetails} noValidate>
      <h2>Edit patient details</h2>
      <div className="grid cols-2" style={{ gap: 0, columnGap: 12 }}>
        <Field label="First name" htmlFor="pd-first" error={state.fields.firstName}><input id="pd-first" className="input" value={form.firstName} onChange={set("firstName")} /></Field>
        <Field label="Last name" htmlFor="pd-last" error={state.fields.lastName}><input id="pd-last" className="input" value={form.lastName} onChange={set("lastName")} /></Field>
        <Field label="Phone" htmlFor="pd-phone" error={state.fields.phone}><input id="pd-phone" className="input" type="tel" value={form.phone} onChange={set("phone")} /></Field>
        <Field label="Date of birth" htmlFor="pd-dob" error={state.fields.dateOfBirth}><input id="pd-dob" className="input" type="date" value={form.dateOfBirth} onChange={set("dateOfBirth")} /></Field>
      </div>
      <Field label="Primary condition" htmlFor="pd-cond" error={state.fields.primaryCondition}><input id="pd-cond" className="input" maxLength={255} value={form.primaryCondition} onChange={set("primaryCondition")} /></Field>
      <Field label="Rehabilitation status" htmlFor="pd-status" error={state.fields.rehabStatus}>
        <select id="pd-status" className="input" value={form.rehabStatus} onChange={set("rehabStatus")}>
          {Object.entries(REHAB_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </Field>
      {state.error && <div className="alert error" style={{ marginBottom: 12 }}>{state.error}</div>}
      <div className="row">
        <button type="submit" className="btn" disabled={state.busy}>{state.busy ? "Saving…" : "Save"}</button>
        <button type="button" className="btn ghost" onClick={() => setEditing(false)}>Cancel</button>
      </div>
    </form>
  );
}

function AccountStatusCard({ patient, onChanged }) {
  const [state, setState] = useState({ busy: false, error: null });
  const active = patient.accountStatus === "ACTIVE";

  async function handleToggleAccount() {
    const question = active
      ? `Deactivate ${patient.firstName}'s account? They will be signed out and cannot sign in until you reactivate it. Their data is kept.`
      : `Reactivate ${patient.firstName}'s account?`;
    if (!window.confirm(question)) return;
    setState({ busy: true, error: null });
    try {
      await therapistApi.setAccountStatus(patient.id, active ? "DISABLED" : "ACTIVE");
      setState({ busy: false, error: null });
      onChanged();
    } catch (err) {
      setState({ busy: false, error: errorMessage(err) });
    }
  }

  return (
    <section className="card">
      <h2>Account</h2>
      <p className="small">
        {active ? "The patient can sign in and use the app." : "The account is deactivated: the patient cannot sign in. Records and history are kept."}
      </p>
      {state.error && <div className="alert error" style={{ marginBottom: 12 }}>{state.error}</div>}
      <button type="button" className={`btn ${active ? "danger" : ""}`} disabled={state.busy} onClick={handleToggleAccount}>
        {state.busy ? "Saving…" : active ? "Deactivate account" : "Reactivate account"}
      </button>
    </section>
  );
}

function RecentSessionsCard({ patientId }) {
  const sessions = useApi(() => therapistApi.sessions(patientId), [patientId]);
  return (
    <section className="card">
      <div className="card-head">
        <h2>Recent sessions</h2>
        <Link to={`/patients/${patientId}?tab=performance`} className="small">Full performance</Link>
      </div>
      {sessions.loading && <Spinner />}
      {sessions.error && <ErrorState message={sessions.error} onRetry={sessions.reload} />}
      {sessions.data?.length === 0 && <p className="muted">No sessions yet.</p>}
      <ul className="list">
        {(sessions.data || []).slice(0, 8).map((s) => (
          <li key={s.id} className="list-item">
            <div className="main">
              <div className="title">{s.exerciseName}</div>
              <div className="sub">{formatDateTime(s.startedAt)} · {s.roundsCompleted}/{s.roundsRequested} reps</div>
            </div>
            {s.status === "COMPLETED"
              ? <Link to={`/reports/${s.id}`}><AccuracyBadge value={sessionAccuracy(s)} /></Link>
              : <StatusBadge status={s.status} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ClinicalNotesCard({ patientId }) {
  const notes = useApi(() => therapistApi.notes(patientId), [patientId]);
  const [text, setText] = useState("");
  const [state, setState] = useState({ busy: false, error: null });

  async function handleAddNote(e) {
    e.preventDefault();
    if (!text.trim()) return setState({ busy: false, error: "Write a note first" });
    setState({ busy: true, error: null });
    try {
      await therapistApi.addNote(patientId, text.trim());
      setText("");
      setState({ busy: false, error: null });
      notes.reload();
    } catch (err) {
      setState({ busy: false, error: errorMessage(err) });
    }
  }

  async function handleDeleteNote(noteId) {
    if (!window.confirm("Delete this note?")) return;
    try {
      await therapistApi.deleteNote(noteId);
      notes.reload();
    } catch (err) {
      setState({ busy: false, error: errorMessage(err) });
    }
  }

  return (
    <section className="card">
      <h2>Clinical notes</h2>
      <p className="small muted">Private to physiotherapists; never shown to the patient.</p>
      <form onSubmit={handleAddNote} noValidate>
        <Field label="New note" htmlFor="note-text" error={state.error}>
          <textarea id="note-text" className="input" rows={3} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <button type="submit" className="btn sm" disabled={state.busy}>{state.busy ? "Saving…" : "Add note"}</button>
      </form>
      {notes.loading && <Spinner />}
      {notes.error && <ErrorState message={notes.error} onRetry={notes.reload} />}
      <ul className="list" style={{ marginTop: 12 }}>
        {(notes.data || []).map((note) => (
          <li key={note.id} className="list-item">
            <div className="main">
              <div className="preserve-lines">{note.text}</div>
              <div className="sub">{note.authorName} · {formatDateTime(note.createdAt)}</div>
            </div>
            {note.writtenByMe && <button type="button" className="btn ghost sm" onClick={() => handleDeleteNote(note.id)}>Delete</button>}
          </li>
        ))}
      </ul>
    </section>
  );
}
