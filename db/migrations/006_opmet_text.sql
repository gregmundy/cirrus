-- Store TAF and SIGMET text reports
CREATE TABLE IF NOT EXISTS opmet_text_reports (
    id BIGSERIAL PRIMARY KEY,
    report_type TEXT NOT NULL,  -- 'TAF', 'SIGMET', 'AIRMET'
    station TEXT,               -- ICAO ID (for TAFs) or FIR ID (for SIGMETs)
    fir_name TEXT,              -- FIR name (for SIGMETs)
    issue_time TIMESTAMPTZ,
    valid_from TIMESTAMPTZ,
    valid_to TIMESTAMPTZ,
    raw_text TEXT NOT NULL,
    hazard TEXT,                -- TS, VA, ICE, TURB, etc (SIGMETs)
    qualifier TEXT,             -- SEV, EMBD, FRQ, etc
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_opmet_text_type ON opmet_text_reports(report_type);
CREATE INDEX IF NOT EXISTS idx_opmet_text_station ON opmet_text_reports(station);
CREATE INDEX IF NOT EXISTS idx_opmet_text_valid ON opmet_text_reports(valid_from);
