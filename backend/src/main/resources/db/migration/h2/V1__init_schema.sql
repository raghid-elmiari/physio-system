-- H2 (zero-install local dev / automated tests) equivalent of mysql/V1 + mysql/V2.
-- MySQL remains the primary database; keep this file in sync when adding MySQL migrations.
-- ENUM/JSON columns are VARCHAR/CLOB here because H2's JSON type double-encodes strings.

CREATE TABLE users (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    first_name      VARCHAR(100)  NOT NULL,
    last_name       VARCHAR(100)  NOT NULL,
    email           VARCHAR(255)  NOT NULL UNIQUE,
    password_hash   VARCHAR(255)  NOT NULL,
    role            VARCHAR(20)   NOT NULL DEFAULT 'PATIENT',
    status          VARCHAR(20)   NOT NULL DEFAULT 'ACTIVE',
    therapist_id    BIGINT NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_user_therapist FOREIGN KEY (therapist_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE exercises (
    id                          BIGINT AUTO_INCREMENT PRIMARY KEY,
    name                        VARCHAR(150) NOT NULL,
    description                 CLOB NULL,
    reference_video_path        VARCHAR(500) NULL,
    reference_keypoints_path    VARCHAR(500) NULL,
    match_stability_seconds     DECIMAL(4,2) NOT NULL DEFAULT 1.50,
    analyzer_key                VARCHAR(64) NULL,
    instructions                CLOB NULL,
    camera_setup                VARCHAR(500) NULL,
    body_region                 VARCHAR(50) NULL,
    default_reps                INT NOT NULL DEFAULT 10,
    analysis_config_json        CLOB NULL,
    active                      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at                  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE devices (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    device_id       VARCHAR(64) NOT NULL UNIQUE,
    device_name     VARCHAR(150) NOT NULL,
    api_key_hash    VARCHAR(255) NOT NULL,
    owner_user_id   BIGINT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    last_seen_at    TIMESTAMP NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_device_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL
);

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
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_assign_patient FOREIGN KEY (patient_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_assign_exercise FOREIGN KEY (exercise_id) REFERENCES exercises(id),
    CONSTRAINT fk_assign_by FOREIGN KEY (assigned_by_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE sessions (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id             BIGINT NOT NULL,
    exercise_id         BIGINT NOT NULL,
    device_id           BIGINT NULL,
    assignment_id       BIGINT NULL,
    client_session_id   VARCHAR(64) NULL,
    rounds_requested    INT NOT NULL,
    rounds_completed    INT NOT NULL DEFAULT 0,
    correct_reps        INT NULL,
    duration_seconds    INT NULL,
    status              VARCHAR(20) NOT NULL DEFAULT 'IN_PROGRESS',
    started_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at            TIMESTAMP NULL,
    CONSTRAINT fk_session_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_session_exercise FOREIGN KEY (exercise_id) REFERENCES exercises(id),
    CONSTRAINT fk_session_device FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL,
    CONSTRAINT fk_session_assignment FOREIGN KEY (assignment_id) REFERENCES exercise_assignments(id) ON DELETE SET NULL,
    CONSTRAINT uq_session_client UNIQUE (user_id, client_session_id)
);

CREATE TABLE session_events (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    session_id          BIGINT NOT NULL,
    event_uid           VARCHAR(64) NOT NULL,
    sequence_no         INT NOT NULL,
    event_timestamp     TIMESTAMP(3) NOT NULL,
    joint_name          VARCHAR(50) NULL,
    deviation_value     DECIMAL(6,2) NULL,
    feedback_message    VARCHAR(255) NULL,
    source              VARCHAR(30) NOT NULL DEFAULT 'GEOMETRIC_COMPARISON',
    event_type          VARCHAR(30) NULL,
    error_code          VARCHAR(50) NULL,
    rep_number          INT NULL,
    CONSTRAINT fk_event_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    CONSTRAINT uq_event_uid UNIQUE (session_id, event_uid)
);

CREATE TABLE session_reports (
    id                      BIGINT AUTO_INCREMENT PRIMARY KEY,
    session_id              BIGINT NOT NULL UNIQUE,
    accuracy_pct            DECIMAL(5,2) NOT NULL,
    total_reps              INT NOT NULL,
    correct_reps            INT NULL,
    duration_seconds        INT NULL,
    common_mistakes_json    CLOB NULL,
    metrics_json            CLOB NULL,
    generated_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_report_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE refresh_tokens (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id         BIGINT NOT NULL,
    token_hash      CHAR(64) NOT NULL UNIQUE,
    expires_at      TIMESTAMP NOT NULL,
    revoked_at      TIMESTAMP NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_refresh_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO exercises (name, description, reference_video_path, reference_keypoints_path,
                       analyzer_key, instructions, camera_setup, body_region, default_reps, analysis_config_json)
VALUES ('Shoulder Raise',
        'Standing bilateral shoulder abduction: raise both straight arms out to the side up to shoulder height, hold briefly, then lower with control.',
        '/data/reference_videos/shoulder_raise.mp4',
        '/data/reference_keypoints/shoulder_raise.json',
        'shoulder_abduction_bilateral',
        'Stand facing the camera with feet hip-width apart and arms relaxed at your sides.' || CHAR(10) ||
        'Keep your elbows straight and thumbs pointing forward.' || CHAR(10) ||
        'Raise both arms out to the side until they reach shoulder height.' || CHAR(10) ||
        'Hold for one second.' || CHAR(10) ||
        'Lower your arms slowly back to your sides.',
        'Place the phone 2-3 m away at chest height, facing you. Your head, both hands and hips must be visible.',
        'Shoulder', 10,
        '{"version":1,"view":"FRONT","minVisibility":0.6,"restMaxAngle":30,"targetAngle":80,"maxAngle":115,"holdMs":1000,"minElbowAngle":150,"maxTrunkLeanDeg":10,"maxAsymmetryDeg":20,"maxAngularSpeedDegPerSec":200,"shrugRatio":0.7,"errorPersistMs":400}');
