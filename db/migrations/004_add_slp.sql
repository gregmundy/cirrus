-- Add sea level pressure column to opmet_reports
-- SLP is the correct pressure for station model plots (not altimeter/QNH)
ALTER TABLE opmet_reports ADD COLUMN IF NOT EXISTS slp_hpa REAL;
