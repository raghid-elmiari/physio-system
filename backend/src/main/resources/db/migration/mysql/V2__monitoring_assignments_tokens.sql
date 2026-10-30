-- V2: on-device exercise monitoring, therapist assignments, refresh tokens.
-- V1 is left byte-for-byte unchanged so databases that already applied it keep a valid
-- Flyway checksum.

-- Patients can be linked to one therapist (who may then assign exercises / see progress).
ALTER TABLE users
    ADD COLUMN therapist_id BIGINT NULL,
    ADD CONSTRAINT fk_user_therapist FOREIGN KEY (therapist_id) REFERENCES users(id) ON DELETE SET NULL;

-- Exercises no longer require a reference video: on-device rule-based analyzers are
-- selected by analyzer_key, and their thresholds live in analysis_config_json.
ALTER TABLE exercises
    MODIFY reference_video_path VARCHAR(500) NULL,
    MODIFY reference_keypoints_path VARCHAR(500) NULL,
    ADD COLUMN analyzer_key VARCHAR(64) NULL,
    ADD COLUMN instructions TEXT NULL,
    ADD COLUMN camera_setup VARCHAR(500) NULL,
    ADD COLUMN body_region VARCHAR(50) NULL,
    ADD COLUMN default_reps INT NOT NULL DEFAULT 10,
    ADD COLUMN analysis_config_json JSON NULL,
    ADD COLUMN active BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE exercise_assignments (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    patient_id          BIGINT NOT NULL,
    exercise_id         BIGINT NOT NULL,
    assigned_by_id      BIGINT NULL,
    target_reps         INT NOT NULL,
    sets_per_session    INT NOT NULL DEFAULT 1,
    sessions_per_week   INT NULL,
    notes               VARCHAR(500) NULL,
    active              BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_assign_patient FOREIGN KEY (patient_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_assign_exercise FOREIGN KEY (exercise_id) REFERENCES exercises(id),
    CONSTRAINT fk_assign_by FOREIGN KEY (assigned_by_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_assign_patient (patient_id)
) ENGINE=InnoDB;

ALTER TABLE sessions
    ADD COLUMN assignment_id BIGINT NULL,
    ADD COLUMN client_session_id VARCHAR(64) NULL,   -- idempotency key for offline sync / retries
    ADD COLUMN duration_seconds INT NULL,
    ADD COLUMN correct_reps INT NULL,
    ADD CONSTRAINT fk_session_assignment FOREIGN KEY (assignment_id) REFERENCES exercise_assignments(id) ON DELETE SET NULL,
    ADD CONSTRAINT uq_session_client UNIQUE (user_id, client_session_id);

ALTER TABLE session_events
    MODIFY joint_name VARCHAR(50) NULL,
    MODIFY deviation_value DECIMAL(6,2) NULL,
    MODIFY source ENUM('GEOMETRIC_COMPARISON','CLASSIFIER','ON_DEVICE_RULES') NOT NULL DEFAULT 'GEOMETRIC_COMPARISON',
    ADD COLUMN event_type VARCHAR(30) NULL,          -- REP_COMPLETED, REP_INCOMPLETE, ERROR, ...
    ADD COLUMN error_code VARCHAR(50) NULL,
    ADD COLUMN rep_number INT NULL;

ALTER TABLE session_reports
    ADD COLUMN correct_reps INT NULL,
    ADD COLUMN duration_seconds INT NULL,
    ADD COLUMN metrics_json JSON NULL;

CREATE TABLE refresh_tokens (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id         BIGINT NOT NULL,
    token_hash      CHAR(64) NOT NULL UNIQUE,         -- SHA-256 of the opaque token; raw token never stored
    expires_at      DATETIME NOT NULL,
    revoked_at      DATETIME NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_refresh_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_refresh_user (user_id)
) ENGINE=InnoDB;

-- Turn the seeded "Shoulder Raise" into the first fully-monitored exercise.
-- Thresholds are an initial, NOT clinically validated starting point; a physiotherapist
-- must calibrate them for the intended protocol (see docs/EXERCISE_ANALYSIS.md).
UPDATE exercises SET
    analyzer_key = 'shoulder_abduction_bilateral',
    description = 'Standing bilateral shoulder abduction: raise both straight arms out to the side up to shoulder height, hold briefly, then lower with control.',
    instructions = 'Stand facing the camera with feet hip-width apart and arms relaxed at your sides.\nKeep your elbows straight and thumbs pointing forward.\nRaise both arms out to the side until they reach shoulder height.\nHold for one second.\nLower your arms slowly back to your sides.',
    camera_setup = 'Place the phone 2-3 m away at chest height, facing you. Your head, both hands and hips must be visible.',
    body_region = 'Shoulder',
    default_reps = 10,
    analysis_config_json = JSON_OBJECT(
        'version', 1,
        'view', 'FRONT',
        'minVisibility', 0.6,
        'restMaxAngle', 30,
        'targetAngle', 80,
        'maxAngle', 115,
        'holdMs', 1000,
        'minElbowAngle', 150,
        'maxTrunkLeanDeg', 10,
        'maxAsymmetryDeg', 20,
        'maxAngularSpeedDegPerSec', 200,
        'shrugRatio', 0.7,
        'errorPersistMs', 400
    )
WHERE name = 'Shoulder Raise';
