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

  // Exercise prescriptions (new ones wait for approval by the patient's own therapist)
  approvePrescription: (assignmentId, body) => data(client.post(`/therapist/assignments/${assignmentId}/approve`, body)),
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

  // Exercise library management (definitions + measurement parameters)
  library: (includeArchived = false) => data(client.get("/therapist/library/exercises", { params: { includeArchived } })),
  createLibraryExercise: (body) => data(client.post("/therapist/library/exercises", body)),
  updateLibraryExercise: (id, body) => data(client.put(`/therapist/library/exercises/${id}`, body)),
  archiveExercise: (id) => data(client.put(`/therapist/library/exercises/${id}/archive`)),
  restoreExercise: (id) => data(client.put(`/therapist/library/exercises/${id}/restore`)),

  // Assessments
  pendingAssessments: () => data(client.get("/therapist/assessments/pending")),
  patientAssessments: (patientId) => data(client.get(`/therapist/patients/${patientId}/assessments`)),
  recordAssessment: (patientId, body) => data(client.post(`/therapist/patients/${patientId}/assessments`, body)),
  assessment: (id) => data(client.get(`/therapist/assessments/${id}`)),
  assessmentHistory: (id) => data(client.get(`/therapist/assessments/${id}/history`)),
  correctAssessment: (id, body) => data(client.post(`/therapist/assessments/${id}/corrections`, body)),
  approveAssessment: (id, comment) => data(client.post(`/therapist/assessments/${id}/approve`, { comment })),
  requestAssessmentRevision: (id, comment) => data(client.post(`/therapist/assessments/${id}/request-revision`, { comment })),

  // Performance and baseline/target comparison
  performances: (patientId) => data(client.get(`/therapist/patients/${patientId}/performances`)),
  recordPerformance: (patientId, body) => data(client.post(`/therapist/patients/${patientId}/performances`, body)),
  performanceFeedback: (performanceId, feedback) => data(client.put(`/therapist/performances/${performanceId}/feedback`, { feedback })),
  rehabProgress: (patientId, from, to) => data(client.get(`/therapist/patients/${patientId}/rehab-progress`, { params: withoutBlanks({ from, to }) })),

  // YouTube suggestions, library videos and patient resources
  videoSubmissions: (status) => data(client.get("/therapist/videos/submissions", { params: withoutBlanks({ status }) })),
  videoSubmission: (id) => data(client.get(`/therapist/videos/submissions/${id}`)),
  approveVideo: (id, body) => data(client.post(`/therapist/videos/submissions/${id}/approve`, body)),
  rejectVideo: (id, reason) => data(client.post(`/therapist/videos/submissions/${id}/reject`, { reason })),
  requestVideoRevision: (id, reason) => data(client.post(`/therapist/videos/submissions/${id}/request-revision`, { reason })),
  videoHistory: () => data(client.get("/therapist/videos/history")),
  videoLibrary: (exerciseId) => data(client.get("/therapist/videos/library", { params: withoutBlanks({ exerciseId }) })),
  addLibraryVideo: (body) => data(client.post("/therapist/videos/library", body)),
  linkLibraryVideo: (id, exerciseId) => data(client.put(`/therapist/videos/library/${id}`, { exerciseId })),
  removeLibraryVideo: (id) => data(client.delete(`/therapist/videos/library/${id}`)),
  videoResources: (patientId) => data(client.get(`/therapist/patients/${patientId}/video-resources`)),
  assignVideoResource: (patientId, body) => data(client.post(`/therapist/patients/${patientId}/video-resources`, body)),
  removeVideoResource: (resourceId) => data(client.delete(`/therapist/video-resources/${resourceId}`)),

  // Exercises analysed against a reference recording (analyzer "reference_dtw").
  createReferenceExercise: (body) => data(client.post("/therapist/exercises", body)),
  updateReferenceExercise: (id, body) => data(client.put(`/therapist/exercises/${id}`, body)),
};

/** Patient self-service. The backend scopes every call to the signed-in patient. */
export const patientApi = {
  assessmentStatus: () => data(client.get("/patient/assessment-status")),
  assessableExercises: () => data(client.get("/patient/assessment-exercises")),
  assessments: () => data(client.get("/patient/assessments")),
  startAssessment: (type) => data(client.post("/patient/assessments", type ? { type } : {})),
  assessment: (id) => data(client.get(`/patient/assessments/${id}`)),
  saveAssessment: (id, body) => data(client.put(`/patient/assessments/${id}`, body)),
  submitAssessment: (id) => data(client.post(`/patient/assessments/${id}/submit`)),
  assessmentHistory: (id) => data(client.get(`/patient/assessments/${id}/history`)),
  performances: () => data(client.get("/patient/performances")),
  logPerformance: (body) => data(client.post("/patient/performances", body)),
  rehabProgress: (from, to) => data(client.get("/patient/rehab-progress", { params: withoutBlanks({ from, to }) })),
  videos: () => data(client.get("/patient/videos")),
  videoSubmissions: () => data(client.get("/patient/video-submissions")),
  suggestVideo: (body) => data(client.post("/patient/video-submissions", body)),
  resubmitVideo: (id, body) => data(client.put(`/patient/video-submissions/${id}`, body)),
};

/** Administrator API (ADMIN only). */
export const adminApi = {
  stats: () => data(client.get("/admin/stats")),
  users: (filters = {}) => data(client.get("/admin/users", { params: withoutBlanks(filters) })),
  createUser: (body) => data(client.post("/admin/users", body)),
  changeRole: (id, role, reason) => data(client.put(`/admin/users/${id}/role`, { role, reason })),
  changeStatus: (id, status, reason) => data(client.put(`/admin/users/${id}/status`, { status, reason })),
  assignTherapist: (patientId, therapistId, reason) => data(client.put(`/admin/patients/${patientId}/therapist`, { therapistId, reason })),
  workloads: () => data(client.get("/admin/therapists/workload")),
  auditLog: (params = {}) => data(client.get("/admin/audit-logs", { params: withoutBlanks(params) })),
  permissions: () => data(client.get("/admin/permissions")),
};

/** The signed-in user's notifications (any role). */
export const notificationsApi = {
  list: (unreadOnly = false) => data(client.get("/notifications", { params: { unreadOnly } })),
  unreadCount: () => data(client.get("/notifications/unread-count")),
  markRead: (id, read = true) => data(client.put(`/notifications/${id}/read`, { read })),
  markAllRead: () => data(client.put("/notifications/read-all")),
};

/** Reports a physiotherapist has shared with the signed-in patient. */
export const myReportsApi = {
  list: () => data(client.get("/reports")),
  get: (reportId) => data(client.get(`/reports/${reportId}`)),
};

export const healthApi = {
  ping: () => data(client.get("/health", { timeout: 4000 })),
};
