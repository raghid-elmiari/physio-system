-- Row Level Security for Supabase.
--
-- Access model: the browser never talks to the database. All reads and writes go through
-- the Spring Boot API, which authenticates every request (JWT) and enforces per-patient
-- authorisation (a patient sees only their own rows; a physiotherapist only their linked
-- patients). The API connects as the table owner, which bypasses RLS.
--
-- Supabase additionally exposes every table in the public schema through its Data API
-- (PostgREST) to the `anon` and `authenticated` roles. Enabling RLS without any policy, and
-- revoking those roles' privileges, makes that path return nothing, so the publishable
-- (anon) key can never be used to read patient data. Add policies here only if the browser
-- is ever given direct database access.

DO $$
DECLARE
    tbl record;
BEGIN
    FOR tbl IN SELECT tablename FROM pg_tables WHERE schemaname = current_schema() LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl.tablename);
    END LOOP;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM anon', current_schema());
        EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM anon', current_schema());
        EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I REVOKE ALL ON TABLES FROM anon', current_schema());
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM authenticated', current_schema());
        EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM authenticated', current_schema());
        EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I REVOKE ALL ON TABLES FROM authenticated', current_schema());
    END IF;
END $$;
