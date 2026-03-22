# Station Observations (METAR on Map) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display live METAR station observations on the map with flight category color coding, wind, weather, and click-for-detail — satisfying SADIS evaluation Criteria 6a and 7a.

**Architecture:** The acquisition service (Rust) polls NOAA AWC's bulk METAR cache CSV every 5 minutes, parses the pre-decoded CSV fields, and inserts into a PostGIS `opmet_reports` table. An `aerodromes` reference table maps ICAO codes to coordinates. The backend (Rust/Axum) serves a `/api/opmet/stations` endpoint returning the latest METAR per station with flight category, position, and key fields. The frontend renders colored station dots via Deck.gl with a click popup showing full METAR details. A 5-minute frontend polling timer handles auto-refresh.

**Tech Stack:** Rust (reqwest, csv, sqlx), PostgreSQL + PostGIS, React + Deck.gl (ScatterplotLayer + TextLayer), OurAirports CSV for reference data, NOAA AWC `metars.cache.csv` for live data.

---

## File Structure

### Database
- **Create:** `db/migrations/003_opmet_data.sql` — `aerodromes` table, `opmet_reports` table (TimescaleDB hypertable), indexes
- **Create:** `db/seed/airports.csv` — OurAirports data filtered to ICAO-coded airports only (~12K rows)
- **Create:** `db/seed/seed_aerodromes.sql` — SQL to load airports.csv into `aerodromes` table

### Acquisition Service (Rust)
- **Create:** `services/acquisition/src/metar.rs` — METAR CSV fetch + parse + insert logic
- **Modify:** `services/acquisition/src/main.rs` — add METAR polling loop alongside existing GRIB polling
- **Modify:** `services/acquisition/src/config.rs` — add `metar_poll_interval_secs` config

### Backend (Rust/Axum)
- **Create:** `services/backend/src/opmet.rs` — `/api/opmet/stations` handler returning latest METARs as JSON
- **Modify:** `services/backend/src/main.rs` — register opmet route

### Frontend (React/TypeScript)
- **Create:** `services/frontend/src/components/map/StationLayer.ts` — Deck.gl layers for station dots + labels
- **Create:** `services/frontend/src/components/StationPopup.tsx` — click popup with METAR details
- **Modify:** `services/frontend/src/stores/appStore.ts` — station data state, fetch, toggle, auto-refresh timer
- **Modify:** `services/frontend/src/components/map/MapView.tsx` — render station layers + popup
- **Modify:** `services/frontend/src/components/Toolbar.tsx` — station visibility toggle

---

## Task 1: Database Schema — Aerodromes and OPMET Reports

**Files:**
- Create: `db/migrations/003_opmet_data.sql`

- [ ] **Step 1: Write the migration**

```sql
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
    report_type   TEXT NOT NULL,          -- 'METAR', 'SPECI', 'TAF', 'SIGMET'
    raw_text      TEXT NOT NULL,
    flight_category TEXT,                  -- 'VFR', 'MVFR', 'IFR', 'LIFR'
    wind_dir_degrees INTEGER,
    wind_speed_kt    INTEGER,
    wind_gust_kt     INTEGER,
    visibility_sm    REAL,
    wx_string        TEXT,                 -- weather phenomena (e.g. '-RA BR')
    sky_cover        TEXT,                 -- lowest ceiling layer type
    ceiling_ft       INTEGER,              -- lowest BKN/OVC base in feet AGL
    temp_c           REAL,
    dewpoint_c       REAL,
    altimeter_inhg   REAL,
    latitude         DOUBLE PRECISION NOT NULL,
    longitude        DOUBLE PRECISION NOT NULL,
    ingested_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, observation_time)
);

-- TimescaleDB hypertable for efficient time-series queries
SELECT create_hypertable('opmet_reports', 'observation_time');

CREATE UNIQUE INDEX idx_opmet_unique_obs ON opmet_reports (station, observation_time, report_type);
CREATE INDEX idx_opmet_station_time ON opmet_reports (station, observation_time DESC);
CREATE INDEX idx_opmet_type_time ON opmet_reports (report_type, observation_time DESC);
CREATE INDEX idx_opmet_flight_cat ON opmet_reports (flight_category, observation_time DESC);

-- Retention policy: keep 28 days of OPMET data (ICAO Annex 3 requirement)
SELECT add_retention_policy('opmet_reports', INTERVAL '28 days');
```

- [ ] **Step 2: Verify migration syntax**

Run: `docker compose exec postgres psql -U cirrus -d cirrus -c "\dt"` to confirm current tables, then:
```bash
docker compose down
docker compose up -d postgres
# Wait for healthy, then check tables exist
docker compose exec postgres psql -U cirrus -d cirrus -c "\dt"
```

Note: Since migrations run from `/docker-entrypoint-initdb.d`, a volume reset may be needed if the database already exists:
```bash
docker compose down -v  # WARNING: destroys existing data
docker compose up -d postgres
```

- [ ] **Step 3: Commit**

```bash
git add db/migrations/003_opmet_data.sql
git commit -m "feat(db): add aerodromes and opmet_reports tables for station observations"
```

---

## Task 2: Aerodrome Reference Data Seed

**Files:**
- Create: `db/seed/load_aerodromes.py` — Python script to download OurAirports CSV and insert into `aerodromes`

We use a Python script rather than raw SQL COPY because:
- We need to filter to only airports with ICAO codes
- We need to handle CSV encoding edge cases
- Can be re-run idempotently

- [ ] **Step 1: Write the seed script**

```python
"""Download OurAirports data and seed the aerodromes table."""

import csv
import io
import logging
import os
import sys
import urllib.request

import psycopg

AIRPORTS_URL = "https://davidmegginson.github.io/ourairports-data/airports.csv"

logger = logging.getLogger(__name__)


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL environment variable required", file=sys.stderr)
        sys.exit(1)

    logger.info("Downloading airports from OurAirports...")
    with urllib.request.urlopen(AIRPORTS_URL) as resp:
        raw = resp.read().decode("utf-8")

    reader = csv.DictReader(io.StringIO(raw))
    airports = []
    for row in reader:
        icao = (row.get("icao_code") or "").strip()
        if not icao or len(icao) != 4:
            continue
        # Skip closed airports
        if row.get("type") == "closed":
            continue
        try:
            lat = float(row["latitude_deg"])
            lon = float(row["longitude_deg"])
        except (ValueError, KeyError):
            continue
        elevation = None
        try:
            elevation = int(float(row.get("elevation_ft", "")))
        except (ValueError, TypeError):
            pass
        airports.append({
            "icao_code": icao,
            "name": row.get("name", ""),
            "latitude": lat,
            "longitude": lon,
            "elevation_ft": elevation,
            "country": row.get("iso_country", ""),
            "continent": row.get("continent", ""),
            "municipality": row.get("municipality", ""),
        })

    logger.info("Parsed %d airports with ICAO codes", len(airports))

    conn = psycopg.connect(database_url)

    sql = """
        INSERT INTO aerodromes (icao_code, name, latitude, longitude, elevation_ft, country, continent, municipality)
        VALUES (%(icao_code)s, %(name)s, %(latitude)s, %(longitude)s, %(elevation_ft)s, %(country)s, %(continent)s, %(municipality)s)
        ON CONFLICT (icao_code) DO UPDATE SET
            name = EXCLUDED.name,
            latitude = EXCLUDED.latitude,
            longitude = EXCLUDED.longitude,
            elevation_ft = EXCLUDED.elevation_ft,
            country = EXCLUDED.country,
            continent = EXCLUDED.continent,
            municipality = EXCLUDED.municipality
    """

    with conn.transaction():
        cur = conn.cursor()
        cur.executemany(sql, airports)

    logger.info("Loaded %d aerodromes into database", len(airports))
    conn.close()


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Test the seed script locally**

Run against the running postgres container:
```bash
cd db/seed
DATABASE_URL="postgresql://cirrus:cirrus@localhost:5432/cirrus" python load_aerodromes.py
```

Verify:
```bash
docker compose exec postgres psql -U cirrus -d cirrus -c "SELECT count(*) FROM aerodromes;"
# Expected: ~12,000 rows
docker compose exec postgres psql -U cirrus -d cirrus -c "SELECT icao_code, name, latitude, longitude FROM aerodromes WHERE icao_code = 'KJFK';"
# Expected: KJFK | John F Kennedy International Airport | 40.639... | -73.778...
```

- [ ] **Step 3: Commit**

```bash
git add db/seed/load_aerodromes.py
git commit -m "feat(db): add aerodrome seed script from OurAirports data"
```

---

## Task 3: METAR Acquisition — Fetch and Store AWC Cache CSV

**Files:**
- Create: `services/acquisition/src/metar.rs`
- Modify: `services/acquisition/src/main.rs`
- Modify: `services/acquisition/src/config.rs`

This task adds a second polling loop to the acquisition service that fetches the AWC bulk METAR cache CSV every 5 minutes and inserts/updates rows in `opmet_reports`.

- [ ] **Step 1: Add METAR poll config**

In `services/acquisition/src/config.rs`, add a field for the METAR cache URL and poll interval:

```rust
// Add to Config struct:
pub metar_cache_url: String,
pub metar_poll_interval_secs: u64,

// Add to from_env():
metar_cache_url: env::var("METAR_CACHE_URL")
    .unwrap_or_else(|_| "https://aviationweather.gov/data/cache/metars.cache.csv".to_string()),
metar_poll_interval_secs: env::var("METAR_POLL_INTERVAL_SECS")
    .ok()
    .and_then(|v| v.parse().ok())
    .unwrap_or(300),
```

- [ ] **Step 2: Write the METAR fetch module**

Create `services/acquisition/src/metar.rs`:

```rust
use chrono::{DateTime, NaiveDateTime, Utc};
use sqlx::PgPool;

/// A parsed METAR row from the AWC cache CSV.
struct MetarRow {
    station: String,
    observation_time: DateTime<Utc>,
    raw_text: String,
    latitude: f64,
    longitude: f64,
    flight_category: Option<String>,
    wind_dir: Option<i32>,
    wind_speed: Option<i32>,
    wind_gust: Option<i32>,
    visibility_sm: Option<f32>,
    wx_string: Option<String>,
    sky_cover: Option<String>,
    ceiling_ft: Option<i32>,
    temp_c: Option<f32>,
    dewpoint_c: Option<f32>,
    altimeter: Option<f32>,
}

/// Fetch the AWC METAR cache CSV and insert into opmet_reports.
pub async fn fetch_and_store(
    client: &reqwest::Client,
    pool: &PgPool,
    cache_url: &str,
) -> Result<usize, String> {
    let body = client
        .get(cache_url)
        .send()
        .await
        .map_err(|e| format!("HTTP fetch failed: {e}"))?
        .text()
        .await
        .map_err(|e| format!("Body read failed: {e}"))?;

    let mut rows = Vec::new();
    let mut rdr = csv::ReaderBuilder::new()
        .comment(Some(b'!'))
        .flexible(true)
        .from_reader(body.as_bytes());

    for result in rdr.records() {
        let record = match result {
            Ok(r) => r,
            Err(_) => continue,
        };
        if let Some(row) = parse_csv_record(&record) {
            rows.push(row);
        }
    }

    if rows.is_empty() {
        return Ok(0);
    }

    let count = insert_metars(pool, &rows).await?;
    Ok(count)
}

fn parse_csv_record(record: &csv::StringRecord) -> Option<MetarRow> {
    // AWC cache CSV columns (0-indexed):
    // 0: raw_text, 1: station_id, 2: observation_time, 3: latitude, 4: longitude,
    // 5: temp_c, 6: dewpoint_c, 7: wind_dir_degrees, 8: wind_speed_kt,
    // 9: wind_gust_kt, 10: visibility_statute_mi, 11: altim_in_hg,
    // 12: sea_level_pressure_mb, 13: corrected, 14: auto, 15: auto_station,
    // 16: maintenance_indicator_on, 17: no_signal, 18: lightning_sensor_off,
    // 19: freezing_rain_sensor_off, 20: present_weather_sensor_off,
    // 21: wx_string, 22: sky_cover, 23: cloud_base_ft_agl,
    // 24: sky_cover, 25: cloud_base_ft_agl, 26: sky_cover, 27: cloud_base_ft_agl,
    // 28: sky_cover, 29: cloud_base_ft_agl,
    // 30: flight_category, 31: metar_type, 32: elevation_m
    let raw_text = record.get(0)?.trim().to_string();
    let station = record.get(1)?.trim().to_string();
    if station.len() != 4 {
        return None;
    }

    let obs_str = record.get(2)?.trim();
    let observation_time = parse_datetime(obs_str)?;
    let latitude = record.get(3)?.trim().parse::<f64>().ok()?;
    let longitude = record.get(4)?.trim().parse::<f64>().ok()?;

    let temp_c = record.get(5).and_then(|s| s.trim().parse().ok());
    let dewpoint_c = record.get(6).and_then(|s| s.trim().parse().ok());
    let wind_dir = record.get(7).and_then(|s| s.trim().parse().ok());
    let wind_speed = record.get(8).and_then(|s| s.trim().parse().ok());
    let wind_gust = record.get(9).and_then(|s| s.trim().parse().ok());
    let visibility_sm = record.get(10).and_then(|s| s.trim().parse().ok());
    let altimeter = record.get(11).and_then(|s| s.trim().parse().ok());
    let wx_string = record.get(21).map(|s| s.trim().to_string()).filter(|s| !s.is_empty());

    // Find the lowest ceiling (BKN or OVC layer)
    let mut ceiling_ft: Option<i32> = None;
    let mut lowest_cover: Option<String> = None;
    for layer_idx in (22..=28).step_by(2) {
        let cover = record.get(layer_idx).map(|s| s.trim()).unwrap_or("");
        let base = record.get(layer_idx + 1).and_then(|s| s.trim().parse::<i32>().ok());
        if (cover == "BKN" || cover == "OVC" || cover == "VV") && base.is_some() {
            if ceiling_ft.is_none() || base.unwrap() < ceiling_ft.unwrap() {
                ceiling_ft = base;
                lowest_cover = Some(cover.to_string());
            }
        }
        if lowest_cover.is_none() && !cover.is_empty() {
            lowest_cover = Some(cover.to_string());
        }
    }

    let flight_category = record.get(30).map(|s| s.trim().to_string()).filter(|s| !s.is_empty());

    Some(MetarRow {
        station,
        observation_time,
        raw_text,
        latitude,
        longitude,
        flight_category,
        wind_dir,
        wind_speed,
        wind_gust,
        visibility_sm,
        wx_string,
        sky_cover: lowest_cover,
        ceiling_ft,
        temp_c,
        dewpoint_c,
        altimeter,
    })
}

fn parse_datetime(s: &str) -> Option<DateTime<Utc>> {
    // AWC uses "2026-03-22T08:00:00Z" ISO format
    DateTime::parse_from_rfc3339(s)
        .map(|dt| dt.with_timezone(&Utc))
        .ok()
        .or_else(|| {
            NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%SZ")
                .ok()
                .map(|ndt| ndt.and_utc())
        })
}

async fn insert_metars(pool: &PgPool, rows: &[MetarRow]) -> Result<usize, String> {
    // Pre-fetch all known ICAO codes to avoid N+1 queries
    let known_stations: std::collections::HashSet<String> =
        sqlx::query_scalar("SELECT icao_code::TEXT FROM aerodromes")
            .fetch_all(pool)
            .await
            .map_err(|e| format!("Fetch aerodromes: {e}"))?
            .into_iter()
            .collect();

    let mut tx = pool.begin().await.map_err(|e| format!("Begin tx: {e}"))?;

    let mut count = 0usize;
    for row in rows {
        if !known_stations.contains(&row.station) {
            continue;
        }

        let result = sqlx::query(
            "INSERT INTO opmet_reports (
                observation_time, station, report_type, raw_text,
                flight_category, wind_dir_degrees, wind_speed_kt, wind_gust_kt,
                visibility_sm, wx_string, sky_cover, ceiling_ft,
                temp_c, dewpoint_c, altimeter_inhg, latitude, longitude
            ) VALUES ($1, $2, 'METAR', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
            ON CONFLICT (station, observation_time, report_type) DO NOTHING"
        )
        .bind(row.observation_time)
        .bind(&row.station)
        .bind(&row.raw_text)
        .bind(&row.flight_category)
        .bind(row.wind_dir)
        .bind(row.wind_speed)
        .bind(row.wind_gust)
        .bind(row.visibility_sm)
        .bind(&row.wx_string)
        .bind(&row.sky_cover)
        .bind(row.ceiling_ft)
        .bind(row.temp_c)
        .bind(row.dewpoint_c)
        .bind(row.altimeter)
        .bind(row.latitude)
        .bind(row.longitude)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Insert METAR: {e}"))?;

        count += result.rows_affected() as usize;
    }

    tx.commit().await.map_err(|e| format!("Commit: {e}"))?;
    Ok(count)
}
```

- [ ] **Step 3: Add `csv` crate dependency**

In `services/Cargo.toml` (workspace root), add `csv = "1"` to workspace dependencies.
In `services/acquisition/Cargo.toml`, add `csv.workspace = true`.

- [ ] **Step 4: Wire METAR polling into main.rs**

In `services/acquisition/src/main.rs`:

```rust
mod metar;  // Add at top with other mod declarations

// Add a second polling loop function:
async fn metar_polling_loop(state: Arc<AppState>) {
    // Initial delay to let aerodromes table populate
    tokio::time::sleep(Duration::from_secs(10)).await;

    let mut ticker = interval(Duration::from_secs(state.config.metar_poll_interval_secs));
    loop {
        ticker.tick().await;
        tracing::info!("Fetching METAR cache from AWC...");
        match metar::fetch_and_store(&state.client, &state.pool, &state.config.metar_cache_url).await {
            Ok(count) => tracing::info!("Ingested {count} new METAR(s)"),
            Err(e) => tracing::error!("METAR fetch failed: {e}"),
        }
    }
}

// In main(), after spawning the GRIB polling loop, add:
let metar_state = state.clone();
tokio::spawn(async move {
    metar_polling_loop(metar_state).await;
});
```

- [ ] **Step 5: Update docker-compose.yml**

Add METAR config env vars to the acquisition service:

```yaml
METAR_CACHE_URL: ${METAR_CACHE_URL:-https://aviationweather.gov/data/cache/metars.cache.csv}
METAR_POLL_INTERVAL_SECS: ${METAR_POLL_INTERVAL_SECS:-300}
```

- [ ] **Step 6: Build and test**

```bash
cd services && cargo build -p acquisition 2>&1
# Should compile without errors
```

- [ ] **Step 7: Commit**

```bash
git add services/acquisition/src/metar.rs services/acquisition/src/main.rs services/acquisition/src/config.rs services/Cargo.toml services/acquisition/Cargo.toml docker-compose.yml
git commit -m "feat(acquisition): add METAR polling from AWC cache CSV"
```

---

## Task 4: Backend API — Serve Latest Station Observations

**Files:**
- Create: `services/backend/src/opmet.rs`
- Modify: `services/backend/src/main.rs`

- [ ] **Step 1: Write the OPMET endpoint**

Create `services/backend/src/opmet.rs`:

```rust
use axum::{extract::State, http::StatusCode, Json};
use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::PgPool;

#[derive(Serialize, sqlx::FromRow)]
pub struct StationObs {
    station: String,
    observation_time: DateTime<Utc>,
    raw_text: String,
    flight_category: Option<String>,
    wind_dir_degrees: Option<i32>,
    wind_speed_kt: Option<i32>,
    wind_gust_kt: Option<i32>,
    visibility_sm: Option<f32>,
    wx_string: Option<String>,
    sky_cover: Option<String>,
    ceiling_ft: Option<i32>,
    temp_c: Option<f32>,
    dewpoint_c: Option<f32>,
    altimeter_inhg: Option<f32>,
    latitude: f64,
    longitude: f64,
}

/// Return the latest METAR for each station observed within the last 3 hours.
pub async fn get_stations(
    State(pool): State<PgPool>,
) -> Result<Json<Vec<StationObs>>, StatusCode> {
    let rows = sqlx::query_as::<_, StationObs>(
        "SELECT DISTINCT ON (station)
            station, observation_time, raw_text, flight_category,
            wind_dir_degrees, wind_speed_kt, wind_gust_kt,
            visibility_sm, wx_string, sky_cover, ceiling_ft,
            temp_c, dewpoint_c, altimeter_inhg, latitude, longitude
        FROM opmet_reports
        WHERE report_type = 'METAR'
          AND observation_time > NOW() - INTERVAL '3 hours'
        ORDER BY station, observation_time DESC"
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| {
        tracing::error!("Failed to query stations: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(rows))
}
```

- [ ] **Step 2: Register the route in main.rs**

In `services/backend/src/main.rs`:

```rust
mod opmet;  // Add at top

// In the Router builder, add:
.route("/api/opmet/stations", get(opmet::get_stations))
```

- [ ] **Step 3: Build and verify**

```bash
cd services && cargo build -p backend 2>&1
# Should compile without errors
```

- [ ] **Step 4: Commit**

```bash
git add services/backend/src/opmet.rs services/backend/src/main.rs
git commit -m "feat(backend): add /api/opmet/stations endpoint for latest METARs"
```

---

## Task 5: Frontend — Station Data Store

**Files:**
- Modify: `services/frontend/src/stores/appStore.ts`

- [ ] **Step 1: Add station types and state**

Add to the store:

```typescript
// Type for a station observation from the API
export interface StationObs {
  station: string;
  observation_time: string;
  raw_text: string;
  flight_category: string | null;
  wind_dir_degrees: number | null;
  wind_speed_kt: number | null;
  wind_gust_kt: number | null;
  visibility_sm: number | null;
  wx_string: string | null;
  sky_cover: string | null;
  ceiling_ft: number | null;
  temp_c: number | null;
  dewpoint_c: number | null;
  altimeter_inhg: number | null;
  latitude: number;
  longitude: number;
}

// Add to AppState interface:
stationData: StationObs[];
stationVisible: boolean;
stationLoading: boolean;
stationError: string | null;
toggleStations: () => void;
fetchStationData: () => Promise<void>;

// Add to create() initial state:
stationData: [],
stationVisible: false,
stationLoading: false,
stationError: null,

// Add toggle:
toggleStations: () => {
  const wasVisible = get().stationVisible;
  set({ stationVisible: !wasVisible });
  if (!wasVisible && get().stationData.length === 0) {
    get().fetchStationData();
  }
},

// Add fetch function:
fetchStationData: async () => {
  set({ stationLoading: true, stationError: null });
  try {
    const res = await fetch('/api/opmet/stations');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: StationObs[] = await res.json();
    set({ stationData: data, stationLoading: false });
  } catch (err) {
    set({
      stationError: err instanceof Error ? err.message : 'Unknown error',
      stationLoading: false,
    });
  }
},
```

- [ ] **Step 2: Add auto-refresh timer**

In `MapView.tsx` (or `App.tsx`), add a `useEffect` that refreshes station data every 5 minutes when visible:

```typescript
useEffect(() => {
  if (!stationVisible) return;
  const timer = setInterval(() => {
    fetchStationData();
  }, 5 * 60 * 1000);
  return () => clearInterval(timer);
}, [stationVisible, fetchStationData]);
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd services/frontend && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add services/frontend/src/stores/appStore.ts
git commit -m "feat(frontend): add station observation state and auto-refresh to store"
```

---

## Task 6: Frontend — Station Map Layer

**Files:**
- Create: `services/frontend/src/components/map/StationLayer.ts`

- [ ] **Step 1: Write the station layer**

Flight category colors per SADIS spec: VFR=green, MVFR=blue, IFR=red, LIFR=magenta. Render as colored dots with zoom-dependent sizing.

```typescript
import { ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import type { PickingInfo } from '@deck.gl/core';
import type { StationObs } from '../../stores/appStore';

const FLIGHT_CAT_COLORS: Record<string, [number, number, number, number]> = {
  VFR:  [0, 200, 0, 220],
  MVFR: [0, 100, 255, 220],
  IFR:  [220, 0, 0, 220],
  LIFR: [200, 0, 200, 220],
};

const DEFAULT_COLOR: [number, number, number, number] = [150, 150, 150, 180];

export function createStationDotsLayer(
  data: StationObs[],
  onClick: (info: PickingInfo<StationObs>) => void,
): Layer | null {
  if (data.length === 0) return null;

  return new ScatterplotLayer<StationObs>({
    id: 'station-dots',
    data,
    getPosition: (d) => [d.longitude, d.latitude],
    getFillColor: (d) => FLIGHT_CAT_COLORS[d.flight_category ?? ''] ?? DEFAULT_COLOR,
    getRadius: 4,
    radiusUnits: 'pixels',
    radiusMinPixels: 3,
    radiusMaxPixels: 8,
    pickable: true,
    antialiasing: true,
    onClick,
  });
}

export function createStationLabelsLayer(data: StationObs[]): Layer | null {
  if (data.length === 0) return null;

  return new TextLayer<StationObs>({
    id: 'station-ids',
    data,
    getPosition: (d) => [d.longitude, d.latitude],
    getText: (d) => d.station,
    getSize: 10,
    getColor: [220, 220, 220, 200],
    getTextAnchor: 'start',
    getAlignmentBaseline: 'center',
    getPixelOffset: [8, 0],
    fontFamily: 'monospace',
    fontWeight: 'bold',
    sizeUnits: 'pixels',
    pickable: false,
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd services/frontend && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add services/frontend/src/components/map/StationLayer.ts
git commit -m "feat(frontend): add station observation Deck.gl layers with flight category colors"
```

---

## Task 7: Frontend — Station Detail Popup

**Files:**
- Create: `services/frontend/src/components/StationPopup.tsx`

- [ ] **Step 1: Write the popup component**

Shows full METAR text and decoded fields when a station dot is clicked.

```typescript
import type React from 'react';
import type { StationObs } from '../stores/appStore';

interface StationPopupProps {
  station: StationObs;
  x: number;
  y: number;
  onClose: () => void;
}

function formatWind(obs: StationObs): string {
  if (obs.wind_speed_kt == null) return 'Calm';
  const dir = obs.wind_dir_degrees != null ? `${obs.wind_dir_degrees}°` : 'VRB';
  const gust = obs.wind_gust_kt ? `G${obs.wind_gust_kt}` : '';
  return `${dir} at ${obs.wind_speed_kt}${gust} kt`;
}

function flightCatStyle(cat: string | null): React.CSSProperties {
  const colors: Record<string, string> = {
    VFR: '#00c800', MVFR: '#0064ff', IFR: '#dc0000', LIFR: '#c800c8',
  };
  return {
    color: colors[cat ?? ''] ?? '#999',
    fontWeight: 'bold',
  };
}

export default function StationPopup({ station, x, y, onClose }: StationPopupProps) {
  return (
    <div
      style={{
        position: 'absolute',
        left: x + 16,
        top: y - 20,
        background: 'rgba(22,33,62,0.97)',
        color: '#e0e0e0',
        padding: '10px 14px',
        borderRadius: 6,
        fontFamily: 'monospace',
        fontSize: 12,
        pointerEvents: 'auto',
        zIndex: 30,
        maxWidth: 420,
        border: '1px solid rgba(255,255,255,0.2)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontWeight: 'bold', fontSize: 14 }}>
          {station.station}
          <span style={{ ...flightCatStyle(station.flight_category), marginLeft: 8 }}>
            {station.flight_category ?? '—'}
          </span>
        </span>
        <button
          onClick={onClose}
          style={{
            background: 'none', border: 'none', color: '#999', cursor: 'pointer',
            fontSize: 16, lineHeight: 1, padding: '0 4px',
          }}
        >
          x
        </button>
      </div>

      <div style={{ color: '#4fc3f7', marginBottom: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {station.raw_text}
      </div>

      <table style={{ fontSize: 11, color: '#bbb', borderSpacing: '8px 2px' }}>
        <tbody>
          <tr><td>Wind</td><td>{formatWind(station)}</td></tr>
          {station.visibility_sm != null && (
            <tr><td>Visibility</td><td>{station.visibility_sm} SM</td></tr>
          )}
          {station.ceiling_ft != null && (
            <tr><td>Ceiling</td><td>{station.ceiling_ft} ft AGL ({station.sky_cover})</td></tr>
          )}
          {station.temp_c != null && (
            <tr><td>Temp/Dew</td><td>{station.temp_c}°C / {station.dewpoint_c ?? '—'}°C</td></tr>
          )}
          {station.altimeter_inhg != null && (
            <tr><td>Altimeter</td><td>{station.altimeter_inhg.toFixed(2)} inHg</td></tr>
          )}
          {station.wx_string && (
            <tr><td>Weather</td><td>{station.wx_string}</td></tr>
          )}
        </tbody>
      </table>

      <div style={{ fontSize: 10, color: '#666', marginTop: 6 }}>
        Observed: {new Date(station.observation_time).toUTCString()}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add services/frontend/src/components/StationPopup.tsx
git commit -m "feat(frontend): add station detail popup component"
```

---

## Task 8: Frontend — Wire Everything into MapView and Toolbar

**Files:**
- Modify: `services/frontend/src/components/map/MapView.tsx`
- Modify: `services/frontend/src/components/Toolbar.tsx`

- [ ] **Step 1: Add station layers and popup to MapView**

In `MapView.tsx`:

```typescript
// Add imports:
import { createStationDotsLayer, createStationLabelsLayer } from './StationLayer';
import StationPopup from '../StationPopup';
import type { StationObs } from '../../stores/appStore';

// Add state for selected station popup:
const [selectedStation, setSelectedStation] = useState<{
  obs: StationObs; x: number; y: number;
} | null>(null);

// Add store subscriptions:
const stationData = useAppStore((s) => s.stationData);
const stationVisible = useAppStore((s) => s.stationVisible);
const fetchStationData = useAppStore((s) => s.fetchStationData);

// Add auto-refresh timer:
useEffect(() => {
  if (!stationVisible) return;
  const timer = setInterval(() => fetchStationData(), 5 * 60 * 1000);
  return () => clearInterval(timer);
}, [stationVisible, fetchStationData]);

// In the layers useEffect, add station layers ABOVE wind barbs:
if (stationVisible && stationData.length > 0) {
  const dotsLayer = createStationDotsLayer(stationData, (info) => {
    if (info.object) {
      setSelectedStation({ obs: info.object, x: info.x, y: info.y });
    }
  });
  if (dotsLayer) layers.push(dotsLayer);
  const labelsLayer = createStationLabelsLayer(stationData);
  if (labelsLayer) layers.push(labelsLayer);
}

// Add to the return JSX, after the wind tooltip:
{selectedStation && (
  <StationPopup
    station={selectedStation.obs}
    x={selectedStation.x}
    y={selectedStation.y}
    onClose={() => setSelectedStation(null)}
  />
)}
```

- [ ] **Step 2: Add Stations toggle to Toolbar**

In `Toolbar.tsx`:

```typescript
// Add store subscriptions:
const stationVisible = useAppStore((s) => s.stationVisible);
const stationLoading = useAppStore((s) => s.stationLoading);
const toggleStations = useAppStore((s) => s.toggleStations);

// Add button after the RH toggle:
<button
  className={stationVisible ? 'toggle-btn active' : 'toggle-btn'}
  onClick={toggleStations}
>
  Stations {stationLoading ? '...' : stationVisible ? 'ON' : 'OFF'}
</button>
```

- [ ] **Step 3: Add dependency arrays**

Update the MapView layers `useEffect` dependency array to include `stationData` and `stationVisible`.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd services/frontend && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add services/frontend/src/components/map/MapView.tsx services/frontend/src/components/Toolbar.tsx
git commit -m "feat(frontend): wire station layers and popup into map view"
```

---

## Task 9: Integration Test — Full Stack Verification

- [ ] **Step 1: Rebuild and start the full stack**

```bash
docker compose down
docker compose build acquisition backend frontend
docker compose up -d
```

- [ ] **Step 2: Seed aerodrome data**

```bash
DATABASE_URL="postgresql://cirrus:cirrus@localhost:5432/cirrus" python db/seed/load_aerodromes.py
```

- [ ] **Step 3: Verify METAR ingestion**

Wait ~30 seconds for the first METAR poll, then:
```bash
docker compose logs acquisition | grep -i metar
# Expected: "Ingested NNNN new METAR(s)"

docker compose exec postgres psql -U cirrus -d cirrus -c "SELECT count(*) FROM opmet_reports WHERE report_type = 'METAR';"
# Expected: several thousand rows
```

- [ ] **Step 4: Verify API endpoint**

```bash
curl -s http://localhost:8080/api/opmet/stations | jq '. | length'
# Expected: several thousand stations

curl -s http://localhost:8080/api/opmet/stations | jq '.[0]'
# Expected: JSON with station, flight_category, latitude, longitude, raw_text, etc.
```

- [ ] **Step 5: Verify frontend**

Open http://localhost:3000 in the browser:
1. Click "Stations ON" in the toolbar
2. Verify colored dots appear at airport locations across the map
3. Verify color coding: green (VFR), blue (MVFR), red (IFR), magenta (LIFR)
4. Click a station dot — verify popup appears with METAR text and decoded fields
5. Close popup by clicking X
6. Zoom in to a region — verify station labels appear
7. Wait 5 minutes — verify stations auto-refresh (check browser network tab for new `/api/opmet/stations` request)

- [ ] **Step 6: Commit any fixes**

```bash
git add -A
git commit -m "fix: integration adjustments for station observations"
```

---

## Summary

| Task | Component | What it does |
|------|-----------|-------------|
| 1 | Database | `aerodromes` + `opmet_reports` tables with TimescaleDB |
| 2 | Seed data | Load ~12K airports from OurAirports |
| 3 | Acquisition | Poll AWC METAR cache CSV every 5 min, insert to DB |
| 4 | Backend | `/api/opmet/stations` — latest METAR per station |
| 5 | Frontend store | Station state, fetch, toggle, auto-refresh timer |
| 6 | Frontend layer | Deck.gl colored dots + labels |
| 7 | Frontend popup | Click-for-detail METAR popup |
| 8 | Frontend wiring | Connect layers + popup to MapView + Toolbar |
| 9 | Integration | Full stack verification |
