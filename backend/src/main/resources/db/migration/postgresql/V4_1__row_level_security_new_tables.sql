-- Re-applies V3_1's Row Level Security lock-down so the tables added in V4 are covered too.
-- Same access model: only the Spring Boot API (table owner) reads or writes data; Supabase's
-- anon/authenticated Data API roles get no rows and no privileges. Safe to re-run.

DO $$
DECLARE
    tbl record;
BEGIN
    -- flyway_schema_history is excluded: Flyway holds a lock on it while migrating, so altering
    -- it here would wait forever. Its privileges are still revoked below.
    FOR tbl IN SELECT tablename FROM pg_tables
               WHERE schemaname = current_schema() AND tablename <> 'flyway_schema_history' LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl.tablename);
    END LOOP;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM anon', current_schema());
        EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM anon', current_schema());
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM authenticated', current_schema());
        EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM authenticated', current_schema());
    END IF;
END $$;
