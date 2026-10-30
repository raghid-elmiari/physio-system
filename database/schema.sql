-- AI Physiotherapy Assistant — one-time MySQL setup (database + application user).
--
-- The tables themselves are created and upgraded automatically by Flyway when the backend
-- starts (backend/src/main/resources/db/migration/mysql/V*.sql). Do NOT create the tables by
-- hand: Flyway refuses to migrate a non-empty schema that has no migration history.
--
-- Run as an administrative MySQL user, after replacing the password:
--   mysql -u root -p < database/schema.sql
-- then put the same password in backend/.env (DB_PASSWORD).

CREATE DATABASE IF NOT EXISTS physio_assistant CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'physio_app'@'localhost' IDENTIFIED BY 'change-me';
GRANT ALL PRIVILEGES ON physio_assistant.* TO 'physio_app'@'localhost';
FLUSH PRIVILEGES;
