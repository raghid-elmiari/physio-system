-- H2 equivalent of mysql/V4__clinical_workflow.sql (keep the three dialects in sync).
-- Adds: configurable exercise parameters, assessments/baselines, prescription targets and
-- approval, performance tracking, YouTube video workflow, notifications, audit log.
-- Only additive changes; existing rows are preserved.

-- ---------------------------------------------------------------- exercise library
ALTER TABLE exercises ADD COLUMN category VARCHAR(50) NULL;
ALTER TABLE exercises ADD COLUMN difficulty_level VARCHAR(20) NULL;
ALTER TABLE exercises ADD COLUMN created_by_id BIGINT NULL;
ALTER TABLE exercises ADD COLUMN updated_at TIMESTAMP NULL;
ALTER TABLE exercises ADD COLUMN archived_at TIMESTAMP NULL;
ALTER TABLE exercises ADD CONSTRAINT fk_exercise_created_by FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE exercise_parameters (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    exercise_id         BIGINT NOT NULL,
    code                VARCHAR(50) NOT NULL,
    label               VARCHAR(100) NOT NULL,
    measurement_type    VARCHAR(20) NOT NULL,
    unit                VARCHAR(20) NOT NULL,
    range_measurement   BOOLEAN NOT NULL DEFAULT FALSE,
    min_valid           DOUBLE NULL,
    max_valid           DOUBLE NULL,
    normal_min          DOUBLE NULL,
    normal_max          DOUBLE NULL,
    higher_is_better    BOOLEAN NOT NULL DEFAULT TRUE,
    assessment_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
    cv_metric_key       VARCHAR(64) NULL,
    sort_order          INT NOT NULL DEFAULT 0,
    active              BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_param_exercise FOREIGN KEY (exercise_id) REFERENCES exercises(id),
    CONSTRAINT uq_param_code UNIQUE (exercise_id, code),
    CONSTRAINT chk_param_valid CHECK (min_valid IS NULL OR max_valid IS NULL OR max_valid >= min_valid)
);

-- ---------------------------------------------------------------- assessments
CREATE TABLE patient_assessments (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    patient_id          BIGINT NOT NULL,
    assessment_type     VARCHAR(20) NOT NULL,
    status              VARCHAR(20) NOT NULL,
    created_by_id       BIGINT NULL,
    supersedes_id       BIGINT NULL,
    patient_notes       VARCHAR(2000) NULL,
    submitted_at        TIMESTAMP NULL,
    reviewed_by_id      BIGINT NULL,
    reviewed_at         TIMESTAMP NULL,
    review_comment      VARCHAR(2000) NULL,
    approved_at         TIMESTAMP NULL,
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP NULL,
    CONSTRAINT fk_assess_patient FOREIGN KEY (patient_id) REFERENCES users(id),
    CONSTRAINT fk_assess_created_by FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_assess_reviewer FOREIGN KEY (reviewed_by_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_assess_supersedes FOREIGN KEY (supersedes_id) REFERENCES patient_assessments(id)
);
CREATE INDEX idx_assess_patient_status ON patient_assessments (patient_id, status);

CREATE TABLE assessment_items (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    assessment_id       BIGINT NOT NULL,
    exercise_id         BIGINT NOT NULL,
    pain_level          INT NULL,
    difficulty_rating   INT NULL,
    independent         BOOLEAN NULL,
    limitation_notes    VARCHAR(1000) NULL,
    CONSTRAINT fk_item_assessment FOREIGN KEY (assessment_id) REFERENCES patient_assessments(id) ON DELETE CASCADE,
    CONSTRAINT fk_item_exercise FOREIGN KEY (exercise_id) REFERENCES exercises(id),
    CONSTRAINT uq_item_exercise UNIQUE (assessment_id, exercise_id),
    CONSTRAINT chk_item_pain CHECK (pain_level IS NULL OR pain_level BETWEEN 0 AND 10),
    CONSTRAINT chk_item_difficulty CHECK (difficulty_rating IS NULL OR difficulty_rating BETWEEN 1 AND 5)
);

-- ---------------------------------------------------------------- prescriptions
ALTER TABLE exercise_assignments ADD COLUMN approved_by_id BIGINT NULL;
ALTER TABLE exercise_assignments ADD COLUMN approved_at TIMESTAMP NULL;
ALTER TABLE exercise_assignments ADD COLUMN approval_note VARCHAR(500) NULL;
ALTER TABLE exercise_assignments ADD COLUMN instructions VARCHAR(4000) NULL;
ALTER TABLE exercise_assignments ADD COLUMN safety_instructions VARCHAR(1000) NULL;
ALTER TABLE exercise_assignments ADD COLUMN expected_progression VARCHAR(1000) NULL;
ALTER TABLE exercise_assignments ADD COLUMN change_reason VARCHAR(500) NULL;
ALTER TABLE exercise_assignments ADD CONSTRAINT fk_assign_approved_by
    FOREIGN KEY (approved_by_id) REFERENCES users(id) ON DELETE SET NULL;
-- Prescriptions created before the approval step existed were put in force by the
-- prescribing physiotherapist, so they are recorded as approved by that person.
UPDATE exercise_assignments SET approved_at = created_at, approved_by_id = assigned_by_id
    WHERE status IN ('ACTIVE', 'PAUSED', 'COMPLETED', 'DISCONTINUED', 'REPLACED');

CREATE TABLE prescription_targets (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    assignment_id       BIGINT NOT NULL,
    parameter_id        BIGINT NOT NULL,
    target_value        DOUBLE NULL,
    target_min          DOUBLE NULL,
    target_max          DOUBLE NULL,
    unit                VARCHAR(20) NOT NULL,
    label               VARCHAR(100) NOT NULL,
    note                VARCHAR(300) NULL,
    CONSTRAINT fk_target_assignment FOREIGN KEY (assignment_id) REFERENCES exercise_assignments(id) ON DELETE CASCADE,
    CONSTRAINT fk_target_parameter FOREIGN KEY (parameter_id) REFERENCES exercise_parameters(id),
    CONSTRAINT uq_target_param UNIQUE (assignment_id, parameter_id)
);

-- ---------------------------------------------------------------- performance
CREATE TABLE exercise_performances (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    assignment_id       BIGINT NOT NULL,
    patient_id          BIGINT NOT NULL,
    session_id          BIGINT NULL UNIQUE,
    performed_at        TIMESTAMP NOT NULL,
    source              VARCHAR(20) NOT NULL,
    recorded_by_id      BIGINT NULL,
    sets_completed      INT NULL,
    reps_completed      INT NULL,
    duration_seconds    INT NULL,
    pain_level          INT NULL,
    difficulty_rating   INT NULL,
    patient_notes       VARCHAR(1000) NULL,
    flagged             BOOLEAN NOT NULL DEFAULT FALSE,
    flag_reason         VARCHAR(500) NULL,
    cv_details          CLOB NULL,
    therapist_feedback  VARCHAR(2000) NULL,
    feedback_by_id      BIGINT NULL,
    feedback_at         TIMESTAMP NULL,
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_perf_assignment FOREIGN KEY (assignment_id) REFERENCES exercise_assignments(id),
    CONSTRAINT fk_perf_patient FOREIGN KEY (patient_id) REFERENCES users(id),
    CONSTRAINT fk_perf_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL,
    CONSTRAINT fk_perf_recorded_by FOREIGN KEY (recorded_by_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_perf_feedback_by FOREIGN KEY (feedback_by_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT chk_perf_pain CHECK (pain_level IS NULL OR pain_level BETWEEN 0 AND 10),
    CONSTRAINT chk_perf_difficulty CHECK (difficulty_rating IS NULL OR difficulty_rating BETWEEN 1 AND 5)
);
CREATE INDEX idx_perf_patient_time ON exercise_performances (patient_id, performed_at);
CREATE INDEX idx_perf_assignment ON exercise_performances (assignment_id, performed_at);

-- One row per measured value, owned by an assessment item or a performance entry.
CREATE TABLE measurements (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    assessment_item_id  BIGINT NULL,
    performance_id      BIGINT NULL,
    parameter_id        BIGINT NOT NULL,
    source              VARCHAR(20) NOT NULL,
    measured_value      DOUBLE NULL,
    measured_min        DOUBLE NULL,
    measured_max        DOUBLE NULL,
    unit                VARCHAR(20) NOT NULL,
    label               VARCHAR(100) NOT NULL,
    note                VARCHAR(500) NULL,
    flagged             BOOLEAN NOT NULL DEFAULT FALSE,
    flag_reason         VARCHAR(300) NULL,
    recorded_by_id      BIGINT NULL,
    corrects_id         BIGINT NULL,
    superseded          BOOLEAN NOT NULL DEFAULT FALSE,
    measured_at         TIMESTAMP NOT NULL,
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_meas_item FOREIGN KEY (assessment_item_id) REFERENCES assessment_items(id),
    CONSTRAINT fk_meas_perf FOREIGN KEY (performance_id) REFERENCES exercise_performances(id),
    CONSTRAINT fk_meas_param FOREIGN KEY (parameter_id) REFERENCES exercise_parameters(id),
    CONSTRAINT fk_meas_recorded_by FOREIGN KEY (recorded_by_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_meas_corrects FOREIGN KEY (corrects_id) REFERENCES measurements(id),
    CONSTRAINT chk_meas_owner CHECK ((assessment_item_id IS NULL AND performance_id IS NOT NULL)
                                  OR (assessment_item_id IS NOT NULL AND performance_id IS NULL))
);
CREATE INDEX idx_meas_item ON measurements (assessment_item_id);
CREATE INDEX idx_meas_perf ON measurements (performance_id);

-- ---------------------------------------------------------------- videos
CREATE TABLE exercise_videos (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    exercise_id         BIGINT NULL,
    youtube_video_id    VARCHAR(11) NOT NULL,
    title               VARCHAR(300) NULL,
    thumbnail_url       VARCHAR(300) NULL,
    channel_name        VARCHAR(200) NULL,
    origin              VARCHAR(30) NOT NULL,
    in_library          BOOLEAN NOT NULL DEFAULT FALSE,
    added_by_id         BIGINT NULL,
    active              BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_video_exercise FOREIGN KEY (exercise_id) REFERENCES exercises(id),
    CONSTRAINT fk_video_added_by FOREIGN KEY (added_by_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_video_exercise ON exercise_videos (exercise_id, active);

CREATE TABLE patient_video_resources (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    patient_id          BIGINT NOT NULL,
    video_id            BIGINT NOT NULL,
    assigned_by_id      BIGINT NULL,
    instructions        VARCHAR(1000) NULL,
    active              BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    removed_at          TIMESTAMP NULL,
    removed_by_id       BIGINT NULL,
    CONSTRAINT fk_res_patient FOREIGN KEY (patient_id) REFERENCES users(id),
    CONSTRAINT fk_res_video FOREIGN KEY (video_id) REFERENCES exercise_videos(id),
    CONSTRAINT fk_res_assigned_by FOREIGN KEY (assigned_by_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_res_removed_by FOREIGN KEY (removed_by_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_res_patient ON patient_video_resources (patient_id, active);

CREATE TABLE patient_video_submissions (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    patient_id          BIGINT NOT NULL,
    therapist_id        BIGINT NULL,
    exercise_id         BIGINT NULL,
    youtube_video_id    VARCHAR(11) NOT NULL,
    original_url        VARCHAR(500) NOT NULL,
    title               VARCHAR(300) NULL,
    thumbnail_url       VARCHAR(300) NULL,
    channel_name        VARCHAR(200) NULL,
    description         VARCHAR(1000) NULL,
    reason              VARCHAR(1000) NULL,
    status              VARCHAR(20) NOT NULL,
    reviewed_by_id      BIGINT NULL,
    reviewed_at         TIMESTAMP NULL,
    feedback            VARCHAR(1000) NULL,
    approved_video_id   BIGINT NULL,
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP NULL,
    CONSTRAINT fk_sub_patient FOREIGN KEY (patient_id) REFERENCES users(id),
    CONSTRAINT fk_sub_therapist FOREIGN KEY (therapist_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_sub_exercise FOREIGN KEY (exercise_id) REFERENCES exercises(id),
    CONSTRAINT fk_sub_reviewer FOREIGN KEY (reviewed_by_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_sub_video FOREIGN KEY (approved_video_id) REFERENCES exercise_videos(id)
);
CREATE INDEX idx_sub_patient ON patient_video_submissions (patient_id, status);
CREATE INDEX idx_sub_therapist ON patient_video_submissions (therapist_id, status);

CREATE TABLE video_review_history (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    submission_id       BIGINT NOT NULL,
    from_status         VARCHAR(20) NULL,
    to_status           VARCHAR(20) NOT NULL,
    actor_id            BIGINT NULL,
    feedback            VARCHAR(1000) NULL,
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_vhist_submission FOREIGN KEY (submission_id) REFERENCES patient_video_submissions(id) ON DELETE CASCADE,
    CONSTRAINT fk_vhist_actor FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_vhist_submission ON video_review_history (submission_id, created_at);

-- ---------------------------------------------------------------- notifications & audit
CREATE TABLE notifications (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    recipient_id        BIGINT NOT NULL,
    type                VARCHAR(40) NOT NULL,
    title               VARCHAR(200) NOT NULL,
    message             VARCHAR(1000) NULL,
    link                VARCHAR(300) NULL,
    entity_type         VARCHAR(40) NULL,
    entity_id           BIGINT NULL,
    read_at             TIMESTAMP NULL,
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_notif_recipient FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_notif_recipient ON notifications (recipient_id, read_at, created_at);

CREATE TABLE audit_logs (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    actor_id            BIGINT NULL,
    actor_role          VARCHAR(20) NULL,
    action              VARCHAR(60) NOT NULL,
    entity_type         VARCHAR(40) NOT NULL,
    entity_id           BIGINT NULL,
    patient_id          BIGINT NULL,
    summary             VARCHAR(500) NULL,
    details             CLOB NULL,
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_audit_actor FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_audit_patient FOREIGN KEY (patient_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_audit_created ON audit_logs (created_at);
CREATE INDEX idx_audit_entity ON audit_logs (entity_type, entity_id);
CREATE INDEX idx_audit_patient ON audit_logs (patient_id, created_at);

-- ---------------------------------------------------------------- library seed data
UPDATE exercises SET category = 'Upper limb', difficulty_level = 'EASY' WHERE analyzer_key = 'shoulder_abduction_bilateral';

INSERT INTO exercise_parameters (exercise_id, code, label, measurement_type, unit, range_measurement,
                                 min_valid, max_valid, normal_min, normal_max, higher_is_better, cv_metric_key, sort_order)
SELECT id, 'abduction_peak', 'Shoulder abduction (highest angle)', 'ANGLE', 'deg', FALSE, 0, 200, 0, 180, TRUE, 'meanPeakAbductionDeg', 1
FROM exercises WHERE analyzer_key = 'shoulder_abduction_bilateral';
INSERT INTO exercise_parameters (exercise_id, code, label, measurement_type, unit, range_measurement,
                                 min_valid, max_valid, normal_min, normal_max, higher_is_better, cv_metric_key, sort_order)
SELECT id, 'repetitions', 'Repetitions completed', 'REPETITIONS', 'count', FALSE, 0, 500, NULL, NULL, TRUE, NULL, 2
FROM exercises WHERE analyzer_key = 'shoulder_abduction_bilateral';

INSERT INTO exercises (name, description, instructions, body_region, default_reps, category, difficulty_level)
VALUES ('Seated Knee Flexion',
        'Seated active knee bend: slide the heel back under the chair as far as is comfortable, then straighten the knee again.',
        'Sit tall on a firm chair with both feet flat on the floor.' || CHAR(10) ||
        'Slowly slide one heel back under the chair, bending the knee as far as is comfortable.' || CHAR(10) ||
        'Hold for a moment, then slide the foot forward to straighten the knee.' || CHAR(10) ||
        'Stop if you feel sharp pain.',
        'Knee', 10, 'Lower limb', 'EASY');
INSERT INTO exercise_parameters (exercise_id, code, label, measurement_type, unit, range_measurement,
                                 min_valid, max_valid, normal_min, normal_max, higher_is_better, sort_order)
SELECT id, 'knee_flexion_rom', 'Knee flexion range of motion', 'ANGLE', 'deg', TRUE, -20, 180, 0, 120, TRUE, 1
FROM exercises WHERE name = 'Seated Knee Flexion';
INSERT INTO exercise_parameters (exercise_id, code, label, measurement_type, unit, range_measurement,
                                 min_valid, max_valid, normal_min, normal_max, higher_is_better, sort_order)
SELECT id, 'repetitions', 'Repetitions completed', 'REPETITIONS', 'count', FALSE, 0, 500, NULL, NULL, TRUE, 2
FROM exercises WHERE name = 'Seated Knee Flexion';
INSERT INTO exercise_parameters (exercise_id, code, label, measurement_type, unit, range_measurement,
                                 min_valid, max_valid, normal_min, normal_max, higher_is_better, sort_order)
SELECT id, 'hold_duration', 'Hold duration', 'DURATION', 's', FALSE, 0, 3600, NULL, NULL, TRUE, 3
FROM exercises WHERE name = 'Seated Knee Flexion';
