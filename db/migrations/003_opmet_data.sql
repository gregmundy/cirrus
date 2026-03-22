-- Aerodrome reference data (loaded from OurAirports)
CREATE TABLE aerodromes (
    icao_code    VARCHAR(4) PRIMARY KEY CHECK (length(icao_code) = 4),
    name         TEXT NOT NULL,
    latitude     DOUBLE PRECISION NOT NULL,
    longitude    DOUBLE PRECISION NOT NULL,
    elevation_ft INTEGER,
    country      TEXT NOT NULL,
    continent    TEXT,
    municipality TEXT,
    geom         GEOMETRY(Point, 4326) GENERATED ALWAYS AS (
        ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
    ) STORED
);

CREATE INDEX idx_aerodromes_geom ON aerodromes USING GIST (geom);
CREATE INDEX idx_aerodromes_country ON aerodromes (country);

-- OPMET observation reports (METARs, SPECIs, TAFs, SIGMETs, etc.)
CREATE TABLE opmet_reports (
    id            BIGSERIAL,
    observation_time TIMESTAMPTZ NOT NULL,
    station       VARCHAR(4) NOT NULL REFERENCES aerodromes(icao_code),
    report_type   TEXT NOT NULL,
    raw_text      TEXT NOT NULL,
    flight_category TEXT,
    wind_dir_degrees INTEGER,
    wind_speed_kt    INTEGER,
    wind_gust_kt     INTEGER,
    visibility_sm    REAL,
    wx_string        TEXT,
    sky_cover        TEXT,
    ceiling_ft       INTEGER,
    temp_c           REAL,
    dewpoint_c       REAL,
    altimeter_inhg   REAL,
    latitude         DOUBLE PRECISION NOT NULL,
    longitude        DOUBLE PRECISION NOT NULL,
    ingested_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, observation_time)
);

SELECT create_hypertable('opmet_reports', 'observation_time');

CREATE UNIQUE INDEX idx_opmet_unique_obs ON opmet_reports (station, observation_time, report_type);
CREATE INDEX idx_opmet_station_time ON opmet_reports (station, observation_time DESC);
CREATE INDEX idx_opmet_type_time ON opmet_reports (report_type, observation_time DESC);
CREATE INDEX idx_opmet_flight_cat ON opmet_reports (flight_category, observation_time DESC);

SELECT add_retention_policy('opmet_reports', INTERVAL '28 days');
