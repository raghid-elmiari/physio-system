-- V3: physiotherapist dashboard.
--   * patient profile details and rehabilitation status
--   * full exercise prescriptions (duration, rest, dates, difficulty, status, history)
--   * physiotherapist notes
--   * stored patient reports (frozen measurement snapshot + professional assessment)
-- Existing rows are preserved; earlier migrations are untouched.

ALTER TABLE users
    ADD COLUMN phone VARCHAR(30) NULL,
    ADD COLUMN date_of_birth DATE NULL,
    ADD COLUMN primary_condition VARCHAR(255) NULL,
    ADD COLUMN rehab_status VARCHAR(20) NULL;

UPDATE users SET rehab_status = 'IN_TREATMENT' WHERE role = 'PATIENT';

-- status replaces the old boolean as the source of truth; `active` is kept (and kept in
-- sync by the application) so existing queries and older clients keep working.
ALTER TABLE exercise_assignments
    ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN duration_seconds INT NULL,
    ADD COLUMN rest_seconds INT NULL,
    ADD COLUMN start_date DATE NULL,
    ADD COLUMN end_date DATE NULL,
    ADD COLUMN difficulty VARCHAR(20) NULL,
    ADD COLUMN previous_assignment_id BIGINT NULL,
    ADD COLUMN updated_at DATETIME NULL,
    ADD CONSTRAINT fk_assign_previous FOREIGN KEY (previous_assignment_id) REFERENCES exercise_assignments(id) ON DELETE SET NULL,
    ADD INDEX idx_assign_patient_status (patient_id, status);

UPDATE exercise_assignments SET status = CASE WHEN active THEN 'ACTIVE' ELSE 'DISCONTINUED' END;

CREATE INDEX idx_sessions_user_started ON sessions (user_id, started_at);

CREATE TABLE therapist_notes (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    patient_id      BIGINT NOT NULL,
    author_id       BIGINT NULL,
    note_text       VARCHAR(4000) NOT NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_note_patient FOREIGN KEY (patient_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_note_author FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_notes_patient (patient_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE patient_reports (
    id                      BIGINT AUTO_INCREMENT PRIMARY KEY,
    patient_id              BIGINT NOT NULL,
    author_id               BIGINT NULL,
    title                   VARCHAR(200) NULL,
    period_start            DATE NOT NULL,
    period_end              DATE NOT NULL,
    measurements_json       JSON NOT NULL,          -- frozen snapshot of system-generated measurements
    observations            VARCHAR(4000) NULL,     -- physiotherapist's professional assessment
    recommendations         VARCHAR(4000) NULL,
    exercise_modifications  VARCHAR(4000) NULL,
    follow_up_instructions  VARCHAR(4000) NULL,
    shared_with_patient     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_report_patient FOREIGN KEY (patient_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_report_author FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_patient_reports_patient (patient_id, created_at)
) ENGINE=InnoDB;
