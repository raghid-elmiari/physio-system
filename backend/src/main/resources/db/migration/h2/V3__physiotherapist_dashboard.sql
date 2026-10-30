-- H2 equivalent of mysql/V3__physiotherapist_dashboard.sql (keep the two in sync).

ALTER TABLE users ADD COLUMN phone VARCHAR(30) NULL;
ALTER TABLE users ADD COLUMN date_of_birth DATE NULL;
ALTER TABLE users ADD COLUMN primary_condition VARCHAR(255) NULL;
ALTER TABLE users ADD COLUMN rehab_status VARCHAR(20) NULL;

UPDATE users SET rehab_status = 'IN_TREATMENT' WHERE role = 'PATIENT';

ALTER TABLE exercise_assignments ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE exercise_assignments ADD COLUMN duration_seconds INT NULL;
ALTER TABLE exercise_assignments ADD COLUMN rest_seconds INT NULL;
ALTER TABLE exercise_assignments ADD COLUMN start_date DATE NULL;
ALTER TABLE exercise_assignments ADD COLUMN end_date DATE NULL;
ALTER TABLE exercise_assignments ADD COLUMN difficulty VARCHAR(20) NULL;
ALTER TABLE exercise_assignments ADD COLUMN previous_assignment_id BIGINT NULL;
ALTER TABLE exercise_assignments ADD COLUMN updated_at TIMESTAMP NULL;
ALTER TABLE exercise_assignments ADD CONSTRAINT fk_assign_previous
    FOREIGN KEY (previous_assignment_id) REFERENCES exercise_assignments(id) ON DELETE SET NULL;
CREATE INDEX idx_assign_patient_status ON exercise_assignments (patient_id, status);

UPDATE exercise_assignments SET status = CASE WHEN active THEN 'ACTIVE' ELSE 'DISCONTINUED' END;

CREATE INDEX idx_sessions_user_started ON sessions (user_id, started_at);

CREATE TABLE therapist_notes (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    patient_id      BIGINT NOT NULL,
    author_id       BIGINT NULL,
    note_text       VARCHAR(4000) NOT NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_note_patient FOREIGN KEY (patient_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_note_author FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_notes_patient ON therapist_notes (patient_id, created_at);

CREATE TABLE patient_reports (
    id                      BIGINT AUTO_INCREMENT PRIMARY KEY,
    patient_id              BIGINT NOT NULL,
    author_id               BIGINT NULL,
    title                   VARCHAR(200) NULL,
    period_start            DATE NOT NULL,
    period_end              DATE NOT NULL,
    measurements_json       CLOB NOT NULL,
    observations            VARCHAR(4000) NULL,
    recommendations         VARCHAR(4000) NULL,
    exercise_modifications  VARCHAR(4000) NULL,
    follow_up_instructions  VARCHAR(4000) NULL,
    shared_with_patient     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_report_patient FOREIGN KEY (patient_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_report_author FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_patient_reports_patient ON patient_reports (patient_id, created_at);
