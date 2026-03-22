# GRIB2 Acquisition & Ingestion Pipeline Design

**Date:** 2026-03-21
**Status:** Draft
**Scope:** End-to-end GRIB2 data retrieval from NOMADS GFS, decoding, and ingestion into PostgreSQL — everything short of visualization.

---

## 1. Goal

Build a working data pipeline that automatically downloads GRIB2 gridded forecast data from NOAA's NOMADS GFS, decodes it with ecCodes, and stores the decoded fields in PostgreSQL. This provides the data foundation that iterations 2+ (wind barbs, contouring, hazards) render from.

### Success Criteria

- Acquisition service polls NOMADS and downloads filtered GFS GRIB2 files on a 6-hourly schedule aligned to GFS model runs
- `POST /api/fetch` triggers an immediate download of the latest available cycle
- Downloaded GRIB2 files are stored on the `grib_store` shared volume
- Decoder service receives notifications, decodes GRIB2 files with ecCodes, and writes fields to `gridded_fields` table
- Each decoded field is queryable by parameter, level, run time, and forecast hour
- Old data is automatically cleaned up after 48 hours
- The full pipeline runs within `docker compose up` with no manual intervention

---

## 2. Data Source: NOMADS GFS

### 2.1 Why NOMADS GFS

The WAFS-specific GRIB2 products (served by SADIS/WIFS APIs) require credentials we don't yet have. The GFS 0.25° dataset on NOMADS contains the same underlying wind, temperature, geopotential height, and humidity data at the same resolution. The GRIB2 format is identical — the decoder doesn't care where the file came from.

When SADIS/WIFS credentials are available, the acquisition service swaps in an OGC EDR client. The decoding and ingestion pipeline stays unchanged.

### 2.2 NOMADS Filter Interface

NOMADS supports server-side subsetting via HTTP GET query parameters, returning a compact GRIB2 file instead of the full ~500MB GFS output.

**Base URL:**
```
https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl
```

**Query parameters per request:**
```
dir=/gfs.{YYYYMMDD}/{HH}/atmos
file=gfs.t{HH}z.pgrb2.0p25.f{FFF}
var_UGRD=on
var_VGRD=on
var_TMP=on
var_HGT=on
var_RH=on
var_PRES=on
lev_850_mb=on&lev_700_mb=on&...  (nearest GFS levels to WAFS flight levels)
lev_tropopause=on
```

### 2.3 Parameters

| Variable | NOMADS Key | ecCodes shortName | Description |
|---|---|---|---|
| U-wind | `var_UGRD` | `u` | Eastward wind component (m/s) |
| V-wind | `var_VGRD` | `v` | Northward wind component (m/s) |
| Temperature | `var_TMP` | `t` | Air temperature (K) |
| Geopotential height | `var_HGT` | `gh` | Height of pressure surface (gpm) |
| Relative humidity | `var_RH` | `r` | Relative humidity (%) |
| Pressure | `var_PRES` | `pres` | Pressure (Pa) — tropopause level only |

### 2.4 Levels

WAFS flight levels mapped to pressure via the ICAO Standard Atmosphere (IRG Section 3.7). Since GFS filter keys only support round integer millibar values, we use the nearest available GFS pressure level:

| Flight Level | ICAO Pressure (hPa) | Nearest GFS Level (hPa) | NOMADS Key |
|---|---|---|---|
| FL050 | 843.1 | 850 | `lev_850_mb` |
| FL100 | 696.8 | 700 | `lev_700_mb` |
| FL140 | 595.2 | 600 | `lev_600_mb` |
| FL180 | 506.6 | 500 | `lev_500_mb` |
| FL240 | 389.0 | 400 | `lev_400_mb` |
| FL300 | 300.9 | 300 | `lev_300_mb` |
| FL340 | 250.0 | 250 | `lev_250_mb` |
| FL390 | 197.0 | 200 | `lev_200_mb` |
| FL450 | 147.5 | 150 | `lev_150_mb` |
| FL530 | 100.0 | 100 | `lev_100_mb` |
| FL600 | 72.0 | 70 | `lev_70_mb` |
| Tropopause | — | — | `lev_tropopause` |

Note: GFS provides these as standard isobaric levels. The approximation error is small (< 10 hPa for most levels) and acceptable for development. When SADIS/WIFS data is available, exact WAFS flight levels will be used directly.

Note: At the tropopause level, GFS only provides temperature (`TMP`) and pressure (`PRES`), not wind, geopotential height, or humidity. The decoder handles this gracefully — it processes whatever messages are present in the GRIB2 file.

### 2.5 Forecast Hours

f006 through f036 in 3-hour steps: `006, 009, 012, 015, 018, 021, 024, 027, 030, 033, 036` — 11 files per cycle.

### 2.6 GFS Publication Schedule

GFS runs 4 times daily. Data availability:

| Model Run | Nominal Time | Typically Available By |
|---|---|---|
| 00Z | 00:00 UTC | ~04:30 UTC |
| 06Z | 06:00 UTC | ~10:30 UTC |
| 12Z | 12:00 UTC | ~16:30 UTC |
| 18Z | 18:00 UTC | ~22:30 UTC |

### 2.7 Download Size Estimate

Per forecast hour: 5 parameters × 11 isobaric levels + 2 tropopause fields (TMP, PRES) = 57 fields × 1440×721 grid ≈ 5–10 MB (GRIB2 compressed).
Per cycle: ~11 forecast hours × ~7 MB ≈ ~80 MB.
Per day: ~4 cycles × ~80 MB ≈ ~320 MB.

---

## 3. Data Flow

```
NOMADS GFS (HTTPS)
    │
    ▼
Acquisition Service (Rust)
    │  - Polls every 5 min, detects new GFS cycles
    │  - Builds NOMADS filter URLs for each forecast hour
    │  - Downloads GRIB2 to /data/grib/{YYYYMMDD}/{HH}/
    │  - Inserts row in grib_downloads table
    │  - pg_notify('decoder_jobs', '{download_id, file_path}')
    │
    ▼
Decoder Service (Python)
    │  - Listens on decoder_jobs channel
    │  - Reads GRIB2 from shared volume
    │  - ecCodes: iterate messages → parameter, level, values array
    │  - Inserts rows in gridded_fields (one per message)
    │  - Marks grib_downloads.decoded = TRUE
    │  - pg_notify('gridded_data_updated')
    │
    ▼
PostgreSQL (gridded_fields table)
    - Queryable by parameter, level, run_time, forecast_hour
```

---

## 4. Database Schema

### 4.1 Migration: `002_gridded_data.sql`

```sql
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
    level_hpa     INTEGER NOT NULL,       -- pressure in hPa; -1 for tropopause
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
```

### 4.2 Design Notes

- `gridded_fields.values` stores float32 arrays in row-major order as raw bytes (~4MB per field for 0.25° global grid)
- `ON DELETE CASCADE` on `download_id` ensures cleanup of gridded fields when downloads are purged
- `valid_time = run_time + forecast_hour * interval '1 hour'` — stored for convenient querying
- `level_hpa` is set to `-1` for tropopause fields (not NULL, to preserve unique constraint behavior); `level_type` distinguishes ('isobaricInhPa' vs 'tropopause')
- No TimescaleDB hypertable — this is bulk-replaced snapshot data, not append-only time-series

---

## 5. Acquisition Service (Rust)

### 5.1 Overview

The existing acquisition service crate (`services/acquisition/`) gains real logic. It becomes an async Rust service with two concurrent tasks: a polling loop and an HTTP API.

### 5.2 Polling Loop

Runs on a tokio interval timer (every 5 minutes):

1. Calculate which GFS cycles should be available based on current UTC time and the publication schedule (nominal run time + 4.5 hours)
2. Query `grib_downloads` to find which cycles we already have
3. For each missing cycle, download all 11 forecast hours:
   a. Build the NOMADS filter URL with all parameters and levels
   b. HTTP GET with reqwest (timeout: 60s)
   c. Write response body to `/data/grib/{YYYYMMDD}/{HH}/gfs_f{FFF}.grib2`
   d. Insert row in `grib_downloads`
   e. Within the same transaction as the `grib_downloads` INSERT, issue the notification:
      ```rust
      sqlx::query("SELECT pg_notify('decoder_jobs', $1)")
          .bind(serde_json::json!({"download_id": id, "file_path": path}).to_string())
          .execute(&pool).await?;
      ```
      This ensures the notification is only sent after the download row is committed (preventing a race where the decoder queries a row that doesn't exist yet).
4. After a successful cycle download, run retention cleanup

### 5.3 On-Demand Fetch

`POST /api/fetch` endpoint:

- Optional query param: `run_time` (ISO 8601) — defaults to latest available cycle
- Triggers the same download logic as the polling loop
- Returns JSON: `{"status": "started", "run_time": "2026-03-21T00:00:00Z", "forecast_hours": 11}`
- Non-blocking — kicks off the download in a background task and returns immediately

### 5.4 Cycle Detection

To determine which cycle to download:

```
current_utc = now()
for run_hour in [18, 12, 06, 00]:  # most recent first
    nominal = today_at(run_hour)
    if nominal > current_utc:
        nominal -= 1 day
    available_at = nominal + 4h30m
    if current_utc >= available_at:
        return nominal  # this cycle should be available
```

### 5.5 NOMADS URL Construction

```rust
fn build_nomads_url(run_time: DateTime<Utc>, forecast_hour: u32) -> String {
    let date = run_time.format("%Y%m%d");
    let hour = run_time.format("%H");
    let fhour = format!("{:03}", forecast_hour);

    let params = [
        "var_UGRD=on", "var_VGRD=on", "var_TMP=on",
        "var_HGT=on", "var_RH=on", "var_PRES=on",
    ];
    let levels = [
        "lev_70_mb=on", "lev_100_mb=on", "lev_150_mb=on", "lev_200_mb=on",
        "lev_250_mb=on", "lev_300_mb=on", "lev_400_mb=on", "lev_500_mb=on",
        "lev_600_mb=on", "lev_700_mb=on", "lev_850_mb=on",
        "lev_tropopause=on",
    ];

    let params_str = params.join("&");
    let levels_str = levels.join("&");

    format!(
        "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl?\
         dir=%2Fgfs.{date}%2F{hour}%2Fatmos&\
         file=gfs.t{hour}z.pgrb2.0p25.f{fhour}&{params_str}&{levels_str}",
        date = date, hour = hour, fhour = fhour,
        params_str = params_str,
        levels_str = levels_str,
    )
}
```

### 5.6 Error Handling

- HTTP request failures: retry up to 3 times with exponential backoff (1s, 2s, 4s)
- Partial cycle downloads are fine — each forecast hour is independent. Failed hours are skipped and retried on the next poll
- NOMADS occasionally returns empty responses or 5xx errors during data publication windows — the retry logic handles this

### 5.7 File Storage

```
/data/grib/
├── 20260321/
│   ├── 00/
│   │   ├── gfs_f006.grib2
│   │   ├── gfs_f009.grib2
│   │   └── ...
│   └── 12/
│       ├── gfs_f006.grib2
│       └── ...
```

### 5.8 Retention Cleanup

After each successful cycle download:

1. Find `grib_downloads` rows where `run_time < now() - RETENTION_HOURS`
2. Delete the GRIB2 files from disk
3. Delete the `grib_downloads` rows (cascades to `gridded_fields`)

`RETENTION_HOURS` defaults to 48, configurable via environment variable.

---

## 6. Decoder Service (Python)

### 6.1 Overview

The existing decoder service (`services/decoder/`) gains GRIB2 decoding logic. It remains a single-threaded process that listens for notifications and processes files sequentially.

### 6.2 NOTIFY Handler

When a notification arrives on `decoder_jobs`:

1. Parse JSON payload: `{"download_id": N, "file_path": "/data/grib/..."}`
2. Query `grib_downloads` WHERE `id = download_id` to retrieve `run_time` and `forecast_hour`
3. Open the GRIB2 file with ecCodes
4. Iterate through all messages
4. For each message, extract metadata and values
5. Insert into `gridded_fields` within a transaction
6. Mark `grib_downloads.decoded = TRUE`
7. `NOTIFY gridded_data_updated`

### 6.3 Decoding Logic

```python
import eccodes
import numpy as np

def decode_grib_file(filepath, download_id, run_time, forecast_hour):
    fields = []
    with open(filepath, 'rb') as f:
        while True:
            msgid = eccodes.codes_grib_new_from_file(f)
            if msgid is None:
                break
            try:
                field = extract_field(msgid, download_id, run_time, forecast_hour)
                if field is not None:
                    fields.append(field)
            finally:
                eccodes.codes_release(msgid)
    return fields

def extract_field(msgid, download_id, run_time, forecast_hour):
    short_name = eccodes.codes_get(msgid, 'shortName')
    level_type_int = eccodes.codes_get(msgid, 'typeOfFirstFixedSurface')

    # Map ecCodes shortName to our parameter names
    param_map = {'u': 'UGRD', 'v': 'VGRD', 't': 'TMP', 'gh': 'HGT', 'r': 'RH', 'pres': 'PRES'}
    parameter = param_map.get(short_name)
    if parameter is None:
        return None  # skip unexpected parameters

    if level_type_int == 7:  # tropopause
        level_hpa = -1  # sentinel value (not NULL, to preserve unique constraint)
        level_type = 'tropopause'
    else:
        level_hpa = eccodes.codes_get(msgid, 'level')
        level_type = 'isobaricInhPa'

    ni = eccodes.codes_get(msgid, 'Ni')
    nj = eccodes.codes_get(msgid, 'Nj')
    values = eccodes.codes_get_array(msgid, 'values').astype(np.float32)

    return {
        'download_id': download_id,
        'run_time': run_time,
        'forecast_hour': forecast_hour,
        'valid_time': run_time + timedelta(hours=forecast_hour),
        'parameter': parameter,
        'level_hpa': level_hpa,
        'level_type': level_type,
        'ni': ni,
        'nj': nj,
        'lat_first': eccodes.codes_get(msgid, 'latitudeOfFirstGridPointInDegrees'),
        'lon_first': eccodes.codes_get(msgid, 'longitudeOfFirstGridPointInDegrees'),
        'lat_last': eccodes.codes_get(msgid, 'latitudeOfLastGridPointInDegrees'),
        'lon_last': eccodes.codes_get(msgid, 'longitudeOfLastGridPointInDegrees'),
        'd_lat': eccodes.codes_get(msgid, 'jDirectionIncrementInDegrees'),
        'd_lon': eccodes.codes_get(msgid, 'iDirectionIncrementInDegrees'),
        'values': values.tobytes(),
    }
```

### 6.4 Database Insert

Uses psycopg's `executemany` with `COPY` or batch insert for performance. Each GRIB2 file produces ~85 field rows (5 params × 17 levels), so a single multi-row insert is efficient enough.

Uses `ON CONFLICT (run_time, forecast_hour, parameter, level_hpa, level_type) DO UPDATE` to handle re-processing of the same file (idempotent).

### 6.5 Error Handling

- If a single GRIB2 message fails to decode, log the error and skip it — process the rest of the file
- If the database transaction fails, the download stays `decoded = FALSE` so it's retried on the next decoder restart
- If the file doesn't exist (deleted between notification and processing), log and skip

---

## 7. Configuration

All configuration via environment variables:

| Variable | Service | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Both | — | PostgreSQL connection string |
| `NOMADS_BASE_URL` | Acquisition | `https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl` | NOMADS filter endpoint |
| `POLL_INTERVAL_SECS` | Acquisition | `300` | How often to check for new cycles (seconds) |
| `RETENTION_HOURS` | Acquisition | `48` | How long to keep old cycles |
| `GRIB_STORE_PATH` | Both | `/data/grib` | Shared volume path for GRIB2 files |

---

## 8. Docker Compose Changes

- Both `acquisition` and `decoder` already mount the `grib_store` volume
- New environment variables added to both services
- Migration `002_gridded_data.sql` auto-applied on next fresh Postgres start (or manual re-init)

---

## 9. What Is Explicitly Out of Scope

- SADIS/WIFS OGC EDR client (future iteration when credentials are available)
- Failover state machine between data sources
- Turbulence, icing, CB parameters (not available on public GFS)
- SIGWX data (IWXXM/BUFR — separate iteration)
- OPMET data (METARs, TAFs — separate iteration)
- Backend API endpoints for serving gridded data to the frontend
- Frontend visualization of any kind
- Tests — will be added in the implementation plan
