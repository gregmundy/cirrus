-- SIGWX features from IWXXM XML
CREATE TABLE IF NOT EXISTS sigwx_features (
    id BIGSERIAL PRIMARY KEY,
    source_file TEXT NOT NULL,
    originating_centre TEXT NOT NULL,
    issue_time TIMESTAMPTZ NOT NULL,
    base_time TIMESTAMPTZ NOT NULL,
    valid_time TIMESTAMPTZ NOT NULL,
    phenomenon TEXT NOT NULL,
    geometry_type TEXT NOT NULL,
    geojson JSONB NOT NULL,
    properties JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sigwx_valid_time ON sigwx_features(valid_time);
CREATE INDEX IF NOT EXISTS idx_sigwx_phenomenon ON sigwx_features(phenomenon);
