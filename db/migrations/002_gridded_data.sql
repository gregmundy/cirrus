-- GRIB2 download tracking and decoded gridded field storage

CREATE TABLE grib_downloads (
    id            BIGSERIAL PRIMARY KEY,
    run_time      TIMESTAMPTZ NOT NULL,
    forecast_hour INTEGER NOT NULL,
    source_url    TEXT NOT NULL,
    file_path     TEXT NOT NULL,
    file_size     BIGINT,
    downloaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decoded       BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE(run_time, forecast_hour)
);

CREATE TABLE gridded_fields (
    id            BIGSERIAL PRIMARY KEY,
    download_id   BIGINT NOT NULL REFERENCES grib_downloads(id) ON DELETE CASCADE,
    run_time      TIMESTAMPTZ NOT NULL,
    forecast_hour INTEGER NOT NULL,
    valid_time    TIMESTAMPTZ NOT NULL,
    parameter     TEXT NOT NULL,
    level_hpa     INTEGER NOT NULL,
    level_type    TEXT NOT NULL,
    ni            INTEGER NOT NULL,
    nj            INTEGER NOT NULL,
    lat_first     DOUBLE PRECISION NOT NULL,
    lon_first     DOUBLE PRECISION NOT NULL,
    lat_last      DOUBLE PRECISION NOT NULL,
    lon_last      DOUBLE PRECISION NOT NULL,
    d_lat         DOUBLE PRECISION NOT NULL,
    d_lon         DOUBLE PRECISION NOT NULL,
    values        BYTEA NOT NULL,
    ingested_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(run_time, forecast_hour, parameter, level_hpa, level_type)
);

CREATE INDEX idx_gridded_fields_lookup
    ON gridded_fields(parameter, level_hpa, run_time, forecast_hour);

CREATE INDEX idx_gridded_fields_valid_time
    ON gridded_fields(valid_time, parameter, level_hpa);
