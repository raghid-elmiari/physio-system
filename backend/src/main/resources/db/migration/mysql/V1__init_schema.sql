-- AI Physiotherapy Assistant — MySQL schema
-- Run with: mysql -u root -p < schema.sql
-- (Also present as backend/src/main/resources/db/migration/V1__init_schema.sql for Flyway auto-apply.)

CREATE DATABASE IF NOT EXISTS physio_assistant CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE physio_assistant;

CREATE TABLE users (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    first_name      VARCHAR(100)  NOT NULL,
    last_name       VARCHAR(100)  NOT NULL,
    email           VARCHAR(255)  NOT NULL UNIQUE,
    password_hash   VARCHAR(255)  NOT NULL,
    role            ENUM('PATIENT','THERAPIST','ADMIN') NOT NULL DEFAULT 'PATIENT',
    status          ENUM('ACTIVE','DISABLED') NOT NULL DEFAULT 'ACTIVE',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE exercises (
    id                          BIGINT AUTO_INCREMENT PRIMARY KEY,
    name                        VARCHAR(150) NOT NULL,
    description                 TEXT NULL,
    reference_video_path        VARCHAR(500) NOT NULL,
    reference_keypoints_path    VARCHAR(500) NOT NULL,
    match_stability_seconds     DECIMAL(4,2) NOT NULL DEFAULT 1.50,  -- from the source paper's Fig 3.1 rule
    created_at                  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE devices (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    device_id       VARCHAR(64) NOT NULL UNIQUE,   -- e.g. "UNOQ-001"
    device_name     VARCHAR(150) NOT NULL,
    api_key_hash    VARCHAR(255) NOT NULL,          -- device auth credential, hashed like a password
    owner_user_id   BIGINT NULL,
    status          ENUM('ACTIVE','DISABLED') NOT NULL DEFAULT 'ACTIVE',
    last_seen_at    DATETIME NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_device_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_devices_owner (owner_user_id)
) ENGINE=InnoDB;

CREATE TABLE sessions (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id             BIGINT NOT NULL,
    exercise_id         BIGINT NOT NULL,
    device_id           BIGINT NULL,                -- which UNO Q / camera device ran this session, if any
    rounds_requested    INT NOT NULL,
    rounds_completed    INT NOT NULL DEFAULT 0,
    status              ENUM('IN_PROGRESS','COMPLETED','ABORTED') NOT NULL DEFAULT 'IN_PROGRESS',
    started_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at            DATETIME NULL,
    CONSTRAINT fk_session_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_session_exercise FOREIGN KEY (exercise_id) REFERENCES exercises(id),
    CONSTRAINT fk_session_device FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL,
    INDEX idx_sessions_user (user_id),
    INDEX idx_sessions_exercise (exercise_id)
) ENGINE=InnoDB;

CREATE TABLE session_events (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    session_id          BIGINT NOT NULL,
    event_uid           VARCHAR(64) NOT NULL,       -- client/device-generated idempotency key
    sequence_no         INT NOT NULL,
    event_timestamp     DATETIME(3) NOT NULL,
    joint_name          VARCHAR(50) NOT NULL,
    deviation_value      DECIMAL(6,2) NOT NULL,
    feedback_message    VARCHAR(255) NULL,
    source              ENUM('GEOMETRIC_COMPARISON','CLASSIFIER') NOT NULL DEFAULT 'GEOMETRIC_COMPARISON',
    CONSTRAINT fk_event_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    CONSTRAINT uq_event_uid UNIQUE (session_id, event_uid),
    INDEX idx_events_session (session_id)
) ENGINE=InnoDB;

CREATE TABLE session_reports (
    id                      BIGINT AUTO_INCREMENT PRIMARY KEY,
    session_id              BIGINT NOT NULL UNIQUE,
    accuracy_pct            DECIMAL(5,2) NOT NULL,
    total_reps              INT NOT NULL,
    common_mistakes_json    JSON NULL,
    generated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_report_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE models (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    name            VARCHAR(150) NOT NULL,
    purpose         VARCHAR(255) NOT NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE model_versions (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    model_id        BIGINT NOT NULL,
    version         VARCHAR(50) NOT NULL,
    format          VARCHAR(50) NOT NULL,           -- e.g. 'TF_SAVEDMODEL', 'TFLITE'
    status          ENUM('ACTIVE','INACTIVE','DEPRECATED') NOT NULL DEFAULT 'ACTIVE',
    file_path       VARCHAR(500) NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_version_model FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE,
    CONSTRAINT uq_model_version UNIQUE (model_id, version)
) ENGINE=InnoDB;

CREATE TABLE predictions (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    session_id          BIGINT NOT NULL,
    device_id           BIGINT NULL,
    model_version_id    BIGINT NOT NULL,
    prediction_label     VARCHAR(100) NOT NULL,      -- e.g. 'exercise' / 'non_exercise'
    confidence          DECIMAL(5,4) NOT NULL,
    processing_time_ms  INT NULL,
    created_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT fk_pred_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    CONSTRAINT fk_pred_device FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL,
    CONSTRAINT fk_pred_model_version FOREIGN KEY (model_version_id) REFERENCES model_versions(id),
    INDEX idx_predictions_session (session_id)
) ENGINE=InnoDB;

CREATE TABLE device_commands (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    device_id       BIGINT NOT NULL,
    command_type    ENUM('START_SESSION','STOP_SESSION','RESET','CALIBRATE') NOT NULL,
    payload_json    JSON NULL,
    status          ENUM('SENT','RECEIVED','EXECUTING','COMPLETED','FAILED','TIMEOUT') NOT NULL DEFAULT 'SENT',
    sent_by_user_id BIGINT NOT NULL,
    sent_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    acknowledged_at DATETIME NULL,
    CONSTRAINT fk_cmd_device FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
    CONSTRAINT fk_cmd_user FOREIGN KEY (sent_by_user_id) REFERENCES users(id),
    INDEX idx_commands_device (device_id)
) ENGINE=InnoDB;

CREATE TABLE alerts (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    session_id      BIGINT NULL,
    device_id       BIGINT NULL,
    severity        ENUM('INFO','WARNING','CRITICAL') NOT NULL DEFAULT 'INFO',
    message         VARCHAR(500) NOT NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at     DATETIME NULL,
    CONSTRAINT fk_alert_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL,
    CONSTRAINT fk_alert_device FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE system_events (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    event_type      VARCHAR(100) NOT NULL,   -- e.g. 'AUTH_FAILURE', 'DEVICE_REGISTERED'
    detail          VARCHAR(500) NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Seed data: one exercise so the system is usable out of the box
INSERT INTO exercises (name, description, reference_video_path, reference_keypoints_path)
VALUES ('Shoulder Raise', 'Slowly raise both arms to shoulder height and hold.',
        '/data/reference_videos/shoulder_raise.mp4',
        '/data/reference_keypoints/shoulder_raise.json');

INSERT INTO models (name, purpose) VALUES ('ExerciseClassifier', 'Classifies exercise vs. non-exercise motion from pose keypoints');
INSERT INTO model_versions (model_id, version, format, status)
VALUES (LAST_INSERT_ID(), '1.0.0', 'TF_SAVEDMODEL', 'ACTIVE');
