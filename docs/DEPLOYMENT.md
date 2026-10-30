# Deploying PhysioCoach (Vercel + Supabase + a Java host)

The architecture stays as it is: React frontend, Spring Boot API, relational database.
Production splits it across three services:

| Part | Where | Why |
|---|---|---|
| React frontend (`frontend/`) | **Vercel** | Static Vite build; camera + MediaPipe run in the patient's browser |
| Spring Boot API (`backend/`) | **Render** (or Railway / Fly.io / any Docker host) | Vercel cannot run a long-lived Java server. `backend/Dockerfile` + `render.yaml` are ready |
| Database | **Supabase PostgreSQL** | Flyway creates and upgrades the schema on API startup (`db/migration/postgresql`) |

Authentication stays with the existing JWT + rotating refresh tokens (BCrypt password
hashes in `users`). Supabase Auth is **not** used: switching would mean replacing the
whole auth layer and every password hash. Supabase Storage is not needed either, because
video never leaves the patient's device (only derived metrics are stored).

## 1. Supabase

1. Create a project at supabase.com. Note the **database password**.
2. Project → **Connect** → *Session pooler* (IPv4, port 5432). Note host and user
   (`aws-0-<region>.pooler.supabase.com`, `postgres.<project-ref>`). Don't use the
   transaction pooler (port 6543): Hibernate relies on prepared statements.
3. Nothing to run by hand. When the API starts with `SPRING_PROFILES_ACTIVE=postgres`,
   Flyway applies:
   - `V1__baseline_schema.sql`: users, exercises, prescriptions, sessions, events, session reports, refresh tokens, plus the Shoulder Raise exercise
   - `V3__physiotherapist_dashboard.sql`: patient details, full prescriptions, notes, patient reports
   - `V3_1__row_level_security.sql`: RLS on every table, privileges revoked from `anon`/`authenticated`
4. Security model: the browser never talks to Supabase. The **anon/publishable key and the
   service-role key are not used anywhere** and must never be put in `VITE_*` variables.
   RLS with no policies means Supabase's public Data API returns nothing even if someone
   has the anon key. Per-patient authorisation (patients see only their own data;
   physiotherapists only their linked patients) is enforced by the API on every request
   and covered by integration tests.
5. Any **future** table must also get `ALTER TABLE … ENABLE ROW LEVEL SECURITY` in its migration.

## 2. Backend on Render

1. Push the project to GitHub. In Render: **New → Blueprint** and select the repo
   (`render.yaml`), or **New → Web Service → Docker** with root directory `backend`.
2. Environment variables:

| Variable | Value |
|---|---|
| `SPRING_PROFILES_ACTIVE` | `postgres` |
| `DB_HOST` / `DB_PORT` / `DB_NAME` | session pooler host / `5432` / `postgres` |
| `DB_USER` / `DB_PASSWORD` | `postgres.<project-ref>` / database password |
| `JWT_SECRET` | `openssl rand -base64 48` (Render can generate it) |
| `CORS_ALLOWED_ORIGINS` | `https://<your-app>.vercel.app` (add custom domains, comma-separated) |
| `SEED_DEMO_DATA` | `false` |

3. Deploy and check `https://<backend>/api/health` returns `{"status":"ok"}`.
4. Render's free plan sleeps after inactivity; the first request then takes ~1 minute.

## 3. Frontend on Vercel

1. Vercel → **Add New → Project** → import the repo, **Root Directory `frontend`**.
   `frontend/vercel.json` sets the build (`npm run build`), output (`dist`), SPA routing and
   security headers.
2. Environment variable: `VITE_API_BASE_URL=https://<backend>/api`.
3. Deploy. Then put the Vercel URL into the backend's `CORS_ALLOWED_ORIGINS` and redeploy
   the backend.
4. The camera needs HTTPS, which Vercel provides.

## 4. First physiotherapist account

Self-registration always creates a PATIENT. To create the first physiotherapist, register
normally in the app, then in Supabase → SQL editor:

```sql
UPDATE users SET role = 'THERAPIST', rehab_status = NULL WHERE email = 'you@clinic.com';
```

The change applies immediately: roles are read from the database on every request.
After that the physiotherapist creates patient accounts from **Patients → Add new patient**.

## 5. Existing data / migration plan

* Local development currently uses the H2 file database (`backend/data/physio.mv.db`).
  It contains development/demo data, so production starts from the clean Supabase schema.
* A MySQL database that already has V1 + V2 is upgraded in place by `mysql/V3` (columns
  added, existing prescriptions mapped to `ACTIVE`/`DISCONTINUED`, nothing deleted).
* To move real MySQL data to Supabase: start the API once against Supabase so Flyway
  creates the schema, then copy table contents in dependency order (users → exercises →
  devices → exercise_assignments → sessions → session_events → session_reports →
  therapist_notes → patient_reports), e.g. with `pgloader` in data-only mode, and reset
  each identity sequence: `SELECT setval(pg_get_serial_sequence('users','id'), max(id)) FROM users;`

## 6. Checklist

- [ ] `/api/health` OK on the backend URL
- [ ] Login works from the Vercel URL (if not: check CORS and `VITE_API_BASE_URL`)
- [ ] Physiotherapist account created and sees the dashboard
- [ ] A patient's live session works on a phone over HTTPS (camera permission)
- [ ] Supabase → Advisors → Security shows no "RLS disabled" warnings
