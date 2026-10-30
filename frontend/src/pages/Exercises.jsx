import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { exercisesApi } from "../api/services";
import { useApi } from "../lib/useApi";
import { EmptyState, ErrorState, Spinner } from "../components/ui";
import ExerciseCard from "../components/ExerciseCard";
import { useAuth } from "../context/AuthContext";

export default function Exercises() {
  const exercises = useApi(() => exercisesApi.list(), []);
  const assignments = useApi(() => exercisesApi.myAssignments(), []);
  const [query, setQuery] = useState("");
  const { user } = useAuth();
  const isTherapist = user?.role === "THERAPIST" || user?.role === "ADMIN";

  const assignmentByExercise = useMemo(() => {
    const m = new Map();
    for (const a of assignments.data || []) if (!m.has(a.exercise.id)) m.set(a.exercise.id, a);
    return m;
  }, [assignments.data]);

  const filtered = (exercises.data || []).filter((e) =>
    `${e.name} ${e.bodyRegion ?? ""} ${e.description ?? ""}`.toLowerCase().includes(query.trim().toLowerCase())
  );

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Exercise library</h1>
          <p>Exercises marked “Camera coach” are analysed live through your camera.</p>
        </div>
        <div className="row">
          <input className="input" style={{ maxWidth: 280 }} type="search" placeholder="Search exercises" aria-label="Search exercises" value={query} onChange={(e) => setQuery(e.target.value)} />
          {isTherapist && <Link className="btn" to="/therapist/exercises/new">New exercise from video</Link>}
        </div>
      </div>
      {exercises.loading && <Spinner label="Loading exercises…" />}
      {exercises.error && <ErrorState message={exercises.error} onRetry={exercises.reload} />}
      {exercises.data && filtered.length === 0 && (
        <div className="card">
          <EmptyState title={query ? "No matching exercises" : "No exercises available"}>{query ? "Try a different search." : "Ask your therapist to add exercises."}</EmptyState>
        </div>
      )}
      <div className="grid cols-2">
        {filtered.map((e) => (
          <ExerciseCard key={e.id} exercise={e} assignment={assignmentByExercise.get(e.id)} />
        ))}
      </div>
    </main>
  );
}
