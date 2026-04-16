CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Users ───────────────────────────────────────────────────────────────────
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name  TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Datasets (one per upload) ────────────────────────────────────────────────
CREATE TABLE datasets (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name                 TEXT NOT NULL,
    dbc_content          TEXT NOT NULL,
    log_filename         TEXT NOT NULL,
    dbc_filename         TEXT NOT NULL,
    recording_start      DOUBLE PRECISION,
    recording_end        DOUBLE PRECISION,
    frame_count          BIGINT NOT NULL DEFAULT 0,
    signal_sample_count  BIGINT NOT NULL DEFAULT 0,
    status               TEXT NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','processing','ready','failed')),
    error_message        TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_datasets_user_created ON datasets (user_id, created_at DESC);

-- ── Raw CAN frames (enables re-decode if DBC changes) ────────────────────────
CREATE TABLE can_frames (
    id          BIGSERIAL PRIMARY KEY,
    dataset_id  UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    timestamp_s DOUBLE PRECISION NOT NULL,
    frame_id    BIGINT NOT NULL,
    frame_data  BYTEA NOT NULL
);
CREATE INDEX idx_can_frames_dataset_time ON can_frames (dataset_id, timestamp_s);

-- ── Signal catalogue per dataset ─────────────────────────────────────────────
CREATE TABLE dataset_signals (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataset_id   UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    signal_name  TEXT NOT NULL,
    unit         TEXT,
    sample_count BIGINT NOT NULL DEFAULT 0,
    value_min    DOUBLE PRECISION,
    value_max    DOUBLE PRECISION,
    value_mean   DOUBLE PRECISION,
    UNIQUE (dataset_id, signal_name)
);
CREATE INDEX idx_dataset_signals_dataset ON dataset_signals (dataset_id);

-- ── Time-series signal samples (hot path) ────────────────────────────────────
CREATE TABLE signal_samples (
    id          BIGSERIAL PRIMARY KEY,
    dataset_id  UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    signal_name TEXT NOT NULL,
    timestamp_s DOUBLE PRECISION NOT NULL,
    value       DOUBLE PRECISION NOT NULL
);
CREATE INDEX idx_signal_samples_dataset_signal_time
    ON signal_samples (dataset_id, signal_name, timestamp_s);

-- ── Refresh tokens ───────────────────────────────────────────────────────────
CREATE TABLE refresh_tokens (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens (token_hash);
