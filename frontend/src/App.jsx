import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import Layout from "./components/Layout";
import { Spinner } from "./components/ui";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import Exercises from "./pages/Exercises";
import ExerciseDetail from "./pages/ExerciseDetail";
import LiveSession from "./pages/LiveSession";
import History from "./pages/History";
import Report from "./pages/Report";
import Progress from "./pages/Progress";
import Profile from "./pages/Profile";
import MyReport from "./pages/MyReport";
import Patients from "./pages/therapist/Patients";
import PatientDetail from "./pages/therapist/PatientDetail";
import PatientReportPage from "./pages/therapist/PatientReportPage";
import ReferenceBuilder from "./pages/therapist/ReferenceBuilder";
import TherapistDashboard from "./pages/therapist/TherapistDashboard";

const STAFF_ROLES = ["THERAPIST", "ADMIN"];

function RequireAuth({ children, roles }) {
  const { user, status } = useAuth();
  const location = useLocation();
  if (status === "restoring") return <Spinner label="Signing you in…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/dashboard" replace />;
  return children;
}

/** Physiotherapists land on their admin dashboard; patients on their exercise dashboard. */
function HomeDashboard() {
  const { user } = useAuth();
  return STAFF_ROLES.includes(user?.role) ? <TherapistDashboard /> : <Dashboard />;
}

function PublicOnly({ children }) {
  const { user, status } = useAuth();
  if (status === "restoring") return <Spinner label="Loading…" />;
  return user ? <Navigate to="/dashboard" replace /> : children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
      <Route path="/register" element={<PublicOnly><Register /></PublicOnly>} />
      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route path="/dashboard" element={<HomeDashboard />} />
        <Route path="/exercises" element={<Exercises />} />
        <Route path="/exercises/:exerciseId" element={<ExerciseDetail />} />
        <Route path="/session/live/:exerciseId" element={<LiveSession />} />
        <Route path="/history" element={<History />} />
        <Route path="/reports/:sessionId" element={<Report />} />
        <Route path="/progress" element={<Progress />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/my-reports/:reportId" element={<MyReport />} />
        {/* Staff-only screens. The backend enforces the same rule on every API call. */}
        <Route path="/patients" element={<RequireAuth roles={STAFF_ROLES}><Patients /></RequireAuth>} />
        <Route path="/patients/:patientId" element={<RequireAuth roles={STAFF_ROLES}><PatientDetail /></RequireAuth>} />
        <Route path="/therapist/reports/:reportId" element={<RequireAuth roles={STAFF_ROLES}><PatientReportPage /></RequireAuth>} />
        <Route path="/therapist/exercises/new" element={<RequireAuth roles={STAFF_ROLES}><ReferenceBuilder /></RequireAuth>} />
        <Route path="/therapist/exercises/:exerciseId/reference" element={<RequireAuth roles={STAFF_ROLES}><ReferenceBuilder /></RequireAuth>} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
