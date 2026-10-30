// Typed-by-convention API contract. Every backend call goes through here, so a mobile app
// (or a future TypeScript client) has one file describing the endpoints it consumes.
import client from "./client";

const data = (request) => request.then((response) => response.data);

/** Drops empty query parameters so the backend sees only real filters. */
function withoutBlanks(params) {
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value != null && value !== ""));
}

export const authApi = {
  login: (email, password) => data(client.post("/auth/login", { email, password })),
  register: (body) => data(client.post("/auth/register", body)),
  logout: (refreshToken) => data(client.post("/auth/logout", { refreshToken })),
};

export const profileApi = {
  me: () => data(client.get("/users/me")),
  update: (body) => data(client.put("/users/me", body)),
  changePassword: (currentPassword, newPassword) => data(client.put("/users/me/password", { currentPassword, newPassword })),
};

export const exercisesApi = {
  list: () => data(client.get("/exercises")),
  get: (id) => data(client.get(`/exercises/${id}`)),
  myAssignments: () => data(client.get("/assignments")),
};

export const sessionsApi = {
  start: (body) => data(client.post("/sessions", body)),
  history: (exerciseId) => data(client.get("/sessions", { params: exerciseId ? { exerciseId } : {} })),
  get: (id) => data(client.get(`/sessions/${id}`)),
  complete: (id, summary) => data(client.post(`/sessions/${id}/complete`, summary)),
  abort: (id, roundsCompleted) => data(client.post(`/sessions/${id}/abort`, { roundsCompleted })),
  sync: (body) => data(client.post("/sessions/sync", body)),
  report: (id) => data(client.get(`/sessions/${id}/report`)),
  events: (id) => data(client.get(`/sessions/${id}/events`)),
  progress: (days = 90) => data(client.get("/progress", { params: { days } })),
};

export const therapistApi = {
  dashboard: () => data(client.get("/therapist/dashboard")),

  // Patients (only the caller's own caseload is ever returned)
  patients: (filters = {}) => data(client.get("/therapist/patients", { params: withoutBlanks(filters) })),
  linkPatient: (email) => data(client.post("/therapist/patients", { email })),
  createPatient: (body) => data(client.post("/therapist/patients/new", body)),
  patient: (id) => data(client.get(`/therapist/patients/${id}`)),
  updatePatient: (id, body) => data(client.put(`/therapist/patients/${id}`, body)),
  setAccountStatus: (id, status) => data(client.put(`/therapist/patients/${id}/account-status`, { status })),
  sessions: (id) => data(client.get(`/therapist/patients/${id}/sessions`)),
  progress: (id, days = 90) => data(client.get(`/therapist/patients/${id}/progress`, { params: { days } })),
  performance: (id, from, to) => data(client.get(`/therapist/patients/${id}/performance`, { params: withoutBlanks({ from, to }) })),

  // Exercise prescriptions
  assignments: (id, { includeHistory = false } = {}) =>
    data(client.get(`/therapist/patients/${id}/assignments`, { params: { includeHistory } })),
  assign: (id, body) => data(client.post(`/therapist/patients/${id}/assignments`, body)),
  revisePrescription: (assignmentId, body) => data(client.put(`/therapist/assignments/${assignmentId}`, body)),
  setPrescriptionStatus: (assignmentId, status) => data(client.put(`/therapist/assignments/${assignmentId}/status`, { status })),
  deactivateAssignment: (assignmentId) => data(client.delete(`/therapist/assignments/${assignmentId}`)),

  // Clinical notes
  notes: (id) => data(client.get(`/therapist/patients/${id}/notes`)),
  addNote: (id, text) => data(client.post(`/therapist/patients/${id}/notes`, { text })),
  deleteNote: (noteId) => data(client.delete(`/therapist/notes/${noteId}`)),

  // Reports
  reports: (id) => data(client.get(`/therapist/patients/${id}/reports`)),
  generateReport: (id, body) => data(client.post(`/therapist/patients/${id}/reports`, body)),
  report: (reportId) => data(client.get(`/therapist/reports/${reportId}`)),
  updateReport: (reportId, body) => data(client.put(`/therapist/reports/${reportId}`, body)),
  deleteReport: (reportId) => data(client.delete(`/therapist/reports/${reportId}`)),

  // Exercises analysed against a reference recording (analyzer "reference_dtw").
  createReferenceExercise: (body) => data(client.post("/therapist/exercises", body)),
  updateReferenceExercise: (id, body) => data(client.put(`/therapist/exercises/${id}`, body)),
};

/** Reports a physiotherapist has shared with the signed-in patient. */
export const myReportsApi = {
  list: () => data(client.get("/reports")),
  get: (reportId) => data(client.get(`/reports/${reportId}`)),
};

export const healthApi = {
  ping: () => data(client.get("/health", { timeout: 4000 })),
};
