# GRIB2 Acquisition & Ingestion Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an end-to-end pipeline that polls NOMADS GFS for GRIB2 data, decodes it with ecCodes, and stores decoded fields in PostgreSQL.

**Architecture:** The Rust acquisition service polls NOMADS, downloads filtered GRIB2 files to a shared Docker volume, and notifies the Python decoder via PostgreSQL NOTIFY. The decoder reads the files, extracts fields with ecCodes, and writes them to a `gridded_fields` table.

**Tech Stack:** Rust (Axum, tokio, reqwest, sqlx, chrono), Python 3.12 (psycopg, eccodes, numpy), PostgreSQL 16 + PostGIS.

**Spec:** `docs/superpowers/specs/2026-03-21-grib2-acquisition-pipeline-design.md`

---

## File Map

### Database
| File | Responsibility |
|---|---|
| `db/migrations/002_gridded_data.sql` | Create `grib_downloads` and `gridded_fields` tables |

### Acquisition Service (`services/acquisition/`)
| File | Responsibility |
|---|---|
| `services/acquisition/Cargo.toml` | Add reqwest, chrono dependencies |
| `services/acquisition/src/main.rs` | Entry point: start HTTP server + polling loop concurrently |
| `services/acquisition/src/nomads.rs` | NOMADS URL construction and HTTP download logic |
| `services/acquisition/src/cycle.rs` | GFS cycle detection (which cycle is available now?) |
| `services/acquisition/src/db.rs` | Database queries: check existing downloads, insert new, cleanup old |
| `services/acquisition/src/config.rs` | Environment variable configuration |

### Decoder Service (`services/decoder/`)
| File | Responsibility |
|---|---|
| `services/decoder/pyproject.toml` | Add numpy dependency |
| `services/decoder/src/cirrus/decoder/main.py` | Entry point: health server + NOTIFY listener with decode handler |
| `services/decoder/src/cirrus/decoder/grib_decoder.py` | GRIB2 decoding with ecCodes: extract fields from file |
| `services/decoder/src/cirrus/decoder/db.py` | Database queries: lookup download, insert fields, mark decoded |

### Docker Compose
| File | Responsibility |
|---|---|
| `docker-compose.yml` | Add new env vars for acquisition and decoder |
| `.env.example` | Add new env var defaults |

---

## Task 1: Database Migration

**Files:**
- Create: `db/migrations/002_gridded_data.sql`

- [ ] **Step 1: Create migration file**

Create `db/migrations/002_gridded_data.sql`:

```sql
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
```

- [ ] **Step 2: Verify migration applies cleanly**

Since migrations run via `/docker-entrypoint-initdb.d` only on fresh Postgres, the easiest way to test is to wipe the volume and restart:

```bash
cd /Users/greg/Development/cirrus
docker compose down -v
docker compose up postgres -d
sleep 5
docker compose exec postgres psql -U cirrus -d cirrus -c "\dt"
```

Expected: both `grib_downloads` and `gridded_fields` tables appear.

```bash
docker compose down
```

- [ ] **Step 3: Commit**

```bash
git add db/migrations/002_gridded_data.sql
git commit -m "feat(db): add grib_downloads and gridded_fields tables"
```

---

## Task 2: Acquisition — Configuration Module

**Files:**
- Create: `services/acquisition/src/config.rs`

- [ ] **Step 1: Create config.rs**

Create `services/acquisition/src/config.rs`:

```rust
use std::env;

pub struct Config {
    pub database_url: String,
    pub nomads_base_url: String,
    pub poll_interval_secs: u64,
    pub retention_hours: i64,
    pub grib_store_path: String,
}

impl Config {
    pub fn from_env() -> Self {
        Self {
            database_url: env::var("DATABASE_URL").expect("DATABASE_URL must be set"),
            nomads_base_url: env::var("NOMADS_BASE_URL")
                .unwrap_or_else(|_| "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl".into()),
            poll_interval_secs: env::var("POLL_INTERVAL_SECS")
                .unwrap_or_else(|_| "300".into())
                .parse()
                .expect("POLL_INTERVAL_SECS must be a number"),
            retention_hours: env::var("RETENTION_HOURS")
                .unwrap_or_else(|_| "48".into())
                .parse()
                .expect("RETENTION_HOURS must be a number"),
            grib_store_path: env::var("GRIB_STORE_PATH")
                .unwrap_or_else(|_| "/data/grib".into()),
        }
    }
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/greg/Development/cirrus
git add services/acquisition/src/config.rs
git commit -m "feat(acquisition): configuration from environment variables"
```

---

## Task 3: Acquisition — Cycle Detection

**Files:**
- Create: `services/acquisition/src/cycle.rs`

- [ ] **Step 1: Create cycle.rs**

Create `services/acquisition/src/cycle.rs`:

```rust
use chrono::{DateTime, Duration, NaiveTime, Timelike, Utc};

/// GFS run hours (UTC)
const RUN_HOURS: [u32; 4] = [18, 12, 6, 0];

/// How long after the nominal run time before data is typically available
const AVAILABILITY_OFFSET_MINUTES: i64 = 270; // 4h30m

/// All forecast hours we download per cycle (f006 through f036, step 3)
pub const FORECAST_HOURS: [u32; 11] = [6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36];

/// Determine the latest GFS cycle that should be available for download.
///
/// GFS runs at 00, 06, 12, 18 UTC. Data is typically available ~4.5 hours
/// after the nominal run time. This function returns the most recent cycle
/// whose data should be available by now, or None if called before the
/// first cycle of the day is available (~04:30 UTC).
pub fn latest_available_cycle(now: DateTime<Utc>) -> Option<DateTime<Utc>> {
    let today = now.date_naive();
    let yesterday = today - Duration::days(1);

    for &run_hour in &RUN_HOURS {
        let nominal_time = NaiveTime::from_hms_opt(run_hour, 0, 0).unwrap();

        // Try today first
        let nominal = today.and_time(nominal_time).and_utc();
        let available_at = nominal + Duration::minutes(AVAILABILITY_OFFSET_MINUTES);
        if now >= available_at {
            return Some(nominal);
        }

        // Try yesterday (handles early morning before today's first cycle)
        let nominal = yesterday.and_time(nominal_time).and_utc();
        let available_at = nominal + Duration::minutes(AVAILABILITY_OFFSET_MINUTES);
        if now >= available_at {
            return Some(nominal);
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn test_latest_cycle_after_00z_available() {
        // 05:00 UTC — 00Z cycle should be available (00:00 + 4:30 = 04:30)
        let now = Utc.with_ymd_and_hms(2026, 3, 21, 5, 0, 0).unwrap();
        let cycle = latest_available_cycle(now).unwrap();
        assert_eq!(cycle, Utc.with_ymd_and_hms(2026, 3, 21, 0, 0, 0).unwrap());
    }

    #[test]
    fn test_latest_cycle_before_00z_available() {
        // 04:00 UTC — 00Z not yet available, should get yesterday's 18Z
        let now = Utc.with_ymd_and_hms(2026, 3, 21, 4, 0, 0).unwrap();
        let cycle = latest_available_cycle(now).unwrap();
        assert_eq!(cycle, Utc.with_ymd_and_hms(2026, 3, 20, 18, 0, 0).unwrap());
    }

    #[test]
    fn test_latest_cycle_afternoon() {
        // 17:00 UTC — 12Z should be available (12:00 + 4:30 = 16:30)
        let now = Utc.with_ymd_and_hms(2026, 3, 21, 17, 0, 0).unwrap();
        let cycle = latest_available_cycle(now).unwrap();
        assert_eq!(cycle, Utc.with_ymd_and_hms(2026, 3, 21, 12, 0, 0).unwrap());
    }

    #[test]
    fn test_latest_cycle_just_before_12z_available() {
        // 16:29 UTC — 12Z not yet available, should get 06Z
        let now = Utc.with_ymd_and_hms(2026, 3, 21, 16, 29, 0).unwrap();
        let cycle = latest_available_cycle(now).unwrap();
        assert_eq!(cycle, Utc.with_ymd_and_hms(2026, 3, 21, 6, 0, 0).unwrap());
    }
}
```

- [ ] **Step 2: Run tests**

```bash
cd /Users/greg/Development/cirrus/services
cargo test -p acquisition -- cycle
```

Expected: 4 tests pass.

- [ ] **Step 3: Commit**

```bash
cd /Users/greg/Development/cirrus
git add services/acquisition/src/cycle.rs
git commit -m "feat(acquisition): GFS cycle detection with availability offset"
```

---

## Task 4: Acquisition — NOMADS URL Construction & Download

**Files:**
- Create: `services/acquisition/src/nomads.rs`
- Modify: `services/acquisition/Cargo.toml` (add reqwest, chrono)

- [ ] **Step 1: Add dependencies to Cargo.toml**

Add to `services/acquisition/Cargo.toml` under `[dependencies]`:

```toml
reqwest = { version = "0.12", features = ["rustls-tls"], default-features = false }
chrono = { version = "0.4", features = ["serde"] }
```

Also add to workspace `services/Cargo.toml` under `[workspace.dependencies]`:

```toml
reqwest = { version = "0.12", features = ["rustls-tls"], default-features = false }
chrono = { version = "0.4", features = ["serde"] }
```

And update the existing `sqlx` line in `services/Cargo.toml` to add the `chrono` feature (required for binding `DateTime<Utc>` in queries):

```toml
sqlx = { version = "0.8", features = ["runtime-tokio", "postgres", "chrono"] }
```

Then update `services/acquisition/Cargo.toml` to use workspace refs:

```toml
reqwest = { workspace = true }
chrono = { workspace = true }
```

- [ ] **Step 2: Create nomads.rs**

Create `services/acquisition/src/nomads.rs`:

```rust
use chrono::{DateTime, Utc};
use std::path::{Path, PathBuf};
use tokio::fs;
use tracing;

/// NOMADS filter parameters for WAFS-relevant GFS variables
const PARAMS: &[&str] = &[
    "var_UGRD=on", "var_VGRD=on", "var_TMP=on",
    "var_HGT=on", "var_RH=on", "var_PRES=on",
];

/// GFS pressure levels approximating WAFS flight levels (see spec Section 2.4)
const LEVELS: &[&str] = &[
    "lev_70_mb=on", "lev_100_mb=on", "lev_150_mb=on", "lev_200_mb=on",
    "lev_250_mb=on", "lev_300_mb=on", "lev_400_mb=on", "lev_500_mb=on",
    "lev_600_mb=on", "lev_700_mb=on", "lev_850_mb=on",
    "lev_tropopause=on",
];

/// Build the NOMADS filter URL for a specific GFS cycle and forecast hour.
pub fn build_url(base_url: &str, run_time: DateTime<Utc>, forecast_hour: u32) -> String {
    let date = run_time.format("%Y%m%d").to_string();
    let hour = run_time.format("%H").to_string();
    let fhour = format!("{:03}", forecast_hour);

    let params_str = PARAMS.join("&");
    let levels_str = LEVELS.join("&");

    format!(
        "{base_url}?dir=%2Fgfs.{date}%2F{hour}%2Fatmos\
         &file=gfs.t{hour}z.pgrb2.0p25.f{fhour}\
         &{params_str}&{levels_str}"
    )
}

/// Build the local file path for a downloaded GRIB2 file.
pub fn file_path(store_path: &str, run_time: DateTime<Utc>, forecast_hour: u32) -> PathBuf {
    let date = run_time.format("%Y%m%d").to_string();
    let hour = run_time.format("%H").to_string();
    Path::new(store_path)
        .join(&date)
        .join(&hour)
        .join(format!("gfs_f{:03}.grib2", forecast_hour))
}

/// Download a single GRIB2 file from NOMADS with retries.
///
/// Returns the file size in bytes on success.
pub async fn download(
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
) -> Result<u64, String> {
    // Ensure parent directory exists
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).await
            .map_err(|e| format!("Failed to create directory {}: {}", parent.display(), e))?;
    }

    const BACKOFF_SECS: [u64; 3] = [1, 2, 4];
    let mut last_err = String::new();
    for attempt in 0..3 {
        if attempt > 0 {
            let delay = std::time::Duration::from_secs(BACKOFF_SECS[attempt]);
            tracing::info!("Retry {}/{} for {} after {delay:?}", attempt, 3, url);
            tokio::time::sleep(delay).await;
        }

        match client.get(url).send().await {
            Ok(resp) => {
                if !resp.status().is_success() {
                    last_err = format!("HTTP {} from {}", resp.status(), url);
                    tracing::warn!("{last_err}");
                    continue;
                }
                match resp.bytes().await {
                    Ok(bytes) => {
                        if bytes.is_empty() {
                            last_err = format!("Empty response from {}", url);
                            tracing::warn!("{last_err}");
                            continue;
                        }
                        fs::write(dest, &bytes).await
                            .map_err(|e| format!("Failed to write {}: {}", dest.display(), e))?;
                        return Ok(bytes.len() as u64);
                    }
                    Err(e) => {
                        last_err = format!("Failed to read response body from {}: {}", url, e);
                        tracing::warn!("{last_err}");
                        continue;
                    }
                }
            }
            Err(e) => {
                last_err = format!("HTTP request failed for {}: {}", url, e);
                tracing::warn!("{last_err}");
                continue;
            }
        }
    }

    Err(format!("All 3 attempts failed for {url}: {last_err}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn test_build_url() {
        let run_time = Utc.with_ymd_and_hms(2026, 3, 21, 12, 0, 0).unwrap();
        let url = build_url(
            "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl",
            run_time,
            6,
        );
        assert!(url.contains("dir=%2Fgfs.20260321%2F12%2Fatmos"));
        assert!(url.contains("file=gfs.t12z.pgrb2.0p25.f006"));
        assert!(url.contains("var_UGRD=on"));
        assert!(url.contains("lev_850_mb=on"));
        assert!(url.contains("lev_tropopause=on"));
        assert!(url.contains("var_PRES=on"));
    }

    #[test]
    fn test_file_path() {
        let run_time = Utc.with_ymd_and_hms(2026, 3, 21, 0, 0, 0).unwrap();
        let path = file_path("/data/grib", run_time, 12);
        assert_eq!(path, PathBuf::from("/data/grib/20260321/00/gfs_f012.grib2"));
    }
}
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/greg/Development/cirrus/services
cargo test -p acquisition -- nomads
```

Expected: 2 tests pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/greg/Development/cirrus
git add services/acquisition/src/nomads.rs services/acquisition/Cargo.toml services/Cargo.toml
git commit -m "feat(acquisition): NOMADS URL construction and download with retries"
```

---

## Task 5: Acquisition — Database Operations

**Files:**
- Create: `services/acquisition/src/db.rs`

- [ ] **Step 1: Create db.rs**

Create `services/acquisition/src/db.rs`:

```rust
use chrono::{DateTime, Duration, Utc};
use sqlx::PgPool;

/// Check which forecast hours are already downloaded for a given cycle.
pub async fn downloaded_forecast_hours(
    pool: &PgPool,
    run_time: DateTime<Utc>,
) -> Result<Vec<i32>, sqlx::Error> {
    let rows = sqlx::query_scalar::<_, i32>(
        "SELECT forecast_hour FROM grib_downloads WHERE run_time = $1"
    )
    .bind(run_time)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Record a successful download in the database and notify the decoder.
///
/// The INSERT and pg_notify happen in the same transaction so the decoder
/// never receives a notification for a row that doesn't exist yet.
///
/// Returns the inserted download ID.
pub async fn record_download(
    pool: &PgPool,
    run_time: DateTime<Utc>,
    forecast_hour: u32,
    source_url: &str,
    file_path: &str,
    file_size: u64,
) -> Result<i64, sqlx::Error> {
    let mut tx = pool.begin().await?;

    let id: i64 = sqlx::query_scalar(
        "INSERT INTO grib_downloads (run_time, forecast_hour, source_url, file_path, file_size)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (run_time, forecast_hour) DO UPDATE
           SET source_url = EXCLUDED.source_url,
               file_path = EXCLUDED.file_path,
               file_size = EXCLUDED.file_size,
               downloaded_at = NOW(),
               decoded = FALSE
         RETURNING id"
    )
    .bind(run_time)
    .bind(forecast_hour as i32)
    .bind(source_url)
    .bind(file_path)
    .bind(file_size as i64)
    .fetch_one(&mut *tx)
    .await?;

    let payload = serde_json::json!({
        "download_id": id,
        "file_path": file_path
    }).to_string();

    sqlx::query("SELECT pg_notify('decoder_jobs', $1)")
        .bind(&payload)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;

    Ok(id)
}

/// Delete downloads (and cascading gridded_fields) older than retention_hours.
///
/// Returns file paths of deleted downloads so the caller can remove files from disk.
pub async fn cleanup_old_downloads(
    pool: &PgPool,
    retention_hours: i64,
) -> Result<Vec<String>, sqlx::Error> {
    let cutoff = Utc::now() - Duration::hours(retention_hours);

    let paths: Vec<String> = sqlx::query_scalar(
        "DELETE FROM grib_downloads WHERE run_time < $1 RETURNING file_path"
    )
    .bind(cutoff)
    .fetch_all(pool)
    .await?;

    Ok(paths)
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/greg/Development/cirrus
git add services/acquisition/src/db.rs
git commit -m "feat(acquisition): database operations for download tracking and cleanup"
```

---

## Task 6: Acquisition — Main Entry Point (Polling + HTTP)

**Files:**
- Modify: `services/acquisition/src/main.rs`

- [ ] **Step 1: Rewrite main.rs**

Replace `services/acquisition/src/main.rs` with the full service that runs the HTTP server and polling loop concurrently:

```rust
mod config;
mod cycle;
mod db;
mod nomads;

use axum::{extract::State, routing::{get, post}, Json, Router};
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use std::sync::Arc;
use tokio::time::{interval, Duration};

const SERVICE_NAME: &str = "acquisition";
const PORT: u16 = 8081;

struct AppState {
    pool: PgPool,
    config: config::Config,
    client: reqwest::Client,
}

async fn health() -> Json<Value> {
    Json(json!({"status": "ok", "service": SERVICE_NAME}))
}

/// Query parameters for POST /api/fetch
#[derive(serde::Deserialize)]
struct FetchParams {
    /// Optional ISO 8601 run_time — defaults to latest available cycle.
    run_time: Option<DateTime<Utc>>,
}

/// POST /api/fetch — trigger an on-demand download.
///
/// Optional query param: `run_time` (ISO 8601) to fetch a specific cycle.
/// Defaults to the latest available cycle.
async fn fetch_now(
    State(state): State<Arc<AppState>>,
    axum::extract::Query(params): axum::extract::Query<FetchParams>,
) -> Json<Value> {
    let run_time = match params.run_time {
        Some(rt) => rt,
        None => match cycle::latest_available_cycle(Utc::now()) {
            Some(rt) => rt,
            None => return Json(json!({"status": "error", "message": "No GFS cycle available yet"})),
        },
    };

    let state = state.clone();
    tokio::spawn(async move {
        if let Err(e) = download_cycle(&state, run_time).await {
            tracing::error!("On-demand fetch failed: {e}");
        }
    });

    Json(json!({
        "status": "started",
        "run_time": run_time.to_rfc3339(),
        "forecast_hours": cycle::FORECAST_HOURS.len()
    }))
}

/// Download all forecast hours for a single GFS cycle.
async fn download_cycle(state: &AppState, run_time: DateTime<Utc>) -> Result<(), String> {
    let existing = db::downloaded_forecast_hours(&state.pool, run_time)
        .await
        .map_err(|e| format!("DB error checking existing downloads: {e}"))?;

    let mut downloaded = 0u32;
    for &fhour in &cycle::FORECAST_HOURS {
        if existing.contains(&(fhour as i32)) {
            tracing::debug!("Skipping {run_time} f{fhour:03} — already downloaded");
            continue;
        }

        let url = nomads::build_url(&state.config.nomads_base_url, run_time, fhour);
        let dest = nomads::file_path(&state.config.grib_store_path, run_time, fhour);

        tracing::info!("Downloading {run_time} f{fhour:03}");
        match nomads::download(&state.client, &url, &dest).await {
            Ok(file_size) => {
                let dest_str = dest.to_string_lossy().to_string();
                match db::record_download(
                    &state.pool, run_time, fhour, &url, &dest_str, file_size,
                ).await {
                    Ok(id) => {
                        tracing::info!(
                            "Downloaded {run_time} f{fhour:03} ({file_size} bytes, id={id})"
                        );
                        downloaded += 1;
                    }
                    Err(e) => tracing::error!("DB insert failed for {run_time} f{fhour:03}: {e}"),
                }
            }
            Err(e) => tracing::warn!("Download failed for {run_time} f{fhour:03}: {e}"),
        }
    }

    if downloaded > 0 {
        // Run retention cleanup after a successful download
        match db::cleanup_old_downloads(&state.pool, state.config.retention_hours).await {
            Ok(paths) => {
                for path in &paths {
                    if let Err(e) = tokio::fs::remove_file(path).await {
                        tracing::warn!("Failed to delete old file {path}: {e}");
                    }
                }
                if !paths.is_empty() {
                    tracing::info!("Cleaned up {} old download(s)", paths.len());
                }
            }
            Err(e) => tracing::warn!("Retention cleanup failed: {e}"),
        }
    }

    tracing::info!("Cycle {run_time}: {downloaded} new file(s) downloaded");
    Ok(())
}

/// Polling loop — runs every POLL_INTERVAL_SECS.
async fn polling_loop(state: Arc<AppState>) {
    let mut ticker = interval(Duration::from_secs(state.config.poll_interval_secs));
    loop {
        ticker.tick().await;
        let now = Utc::now();
        tracing::debug!("Polling for new GFS cycles at {now}");

        if let Some(run_time) = cycle::latest_available_cycle(now) {
            if let Err(e) = download_cycle(&state, run_time).await {
                tracing::error!("Polling download failed: {e}");
            }
        }
    }
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .init();

    let config = config::Config::from_env();

    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&config.database_url)
        .await
        .expect("Failed to connect to database");

    let _conn = pool.acquire().await.expect("Failed to acquire connection");
    tracing::info!("{SERVICE_NAME} connected to database");

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .expect("Failed to create HTTP client");

    let state = Arc::new(AppState { pool, config, client });

    // Start polling loop in background
    let poll_state = state.clone();
    tokio::spawn(async move {
        polling_loop(poll_state).await;
    });

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/fetch", post(fetch_now))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{PORT}"))
        .await
        .expect("Failed to bind");
    tracing::info!("{SERVICE_NAME} listening on port {PORT}");

    axum::serve(listener, app).await.expect("Server error");
}
```

- [ ] **Step 2: Verify workspace compiles**

```bash
cd /Users/greg/Development/cirrus/services
cargo check -p acquisition
```

Expected: compiles without errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/greg/Development/cirrus
git add services/acquisition/src/main.rs
git commit -m "feat(acquisition): polling loop, on-demand fetch, and retention cleanup"
```

---

## Task 7: Decoder — GRIB2 Decoding Module

**Files:**
- Create: `services/decoder/src/cirrus/decoder/grib_decoder.py`
- Modify: `services/decoder/pyproject.toml` (add numpy)

- [ ] **Step 1: Add numpy dependency**

In `services/decoder/pyproject.toml`, add `numpy` to the `decode` optional dependencies:

```toml
[project.optional-dependencies]
decode = [
    "eccodes>=2.0",
    "lxml>=5.0",
    "shapely>=2.0",
    "numpy>=2.0",
]
```

- [ ] **Step 2: Create grib_decoder.py**

Create `services/decoder/src/cirrus/decoder/grib_decoder.py`:

```python
"""GRIB2 decoding using ecCodes — extracts gridded fields from GRIB2 files."""

import logging
from datetime import datetime, timedelta, timezone

import eccodes
import numpy as np

logger = logging.getLogger(__name__)

# Map ecCodes shortName to our canonical parameter names
PARAM_MAP = {
    "u": "UGRD",
    "v": "VGRD",
    "t": "TMP",
    "gh": "HGT",
    "r": "RH",
    "pres": "PRES",
}

# GRIB2 Table 4.5: type 7 = tropopause
TROPOPAUSE_SURFACE_TYPE = 7


def decode_file(filepath: str, download_id: int, run_time: datetime, forecast_hour: int) -> list[dict]:
    """Decode all GRIB2 messages in a file and return a list of field dicts.

    Each dict contains all columns needed for insertion into the gridded_fields table.
    Messages with unrecognized parameters are silently skipped.
    Messages that fail to decode are logged and skipped.
    """
    fields = []
    with open(filepath, "rb") as f:
        while True:
            msgid = eccodes.codes_grib_new_from_file(f)
            if msgid is None:
                break
            try:
                field = _extract_field(msgid, download_id, run_time, forecast_hour)
                if field is not None:
                    fields.append(field)
            except Exception:
                logger.exception("Failed to decode GRIB2 message in %s, skipping", filepath)
            finally:
                eccodes.codes_release(msgid)

    logger.info("Decoded %d fields from %s", len(fields), filepath)
    return fields


def _extract_field(msgid: int, download_id: int, run_time: datetime, forecast_hour: int) -> dict | None:
    """Extract a single gridded field from a GRIB2 message."""
    short_name = eccodes.codes_get(msgid, "shortName")

    parameter = PARAM_MAP.get(short_name)
    if parameter is None:
        return None

    level_type_int = eccodes.codes_get(msgid, "typeOfFirstFixedSurface")

    if level_type_int == TROPOPAUSE_SURFACE_TYPE:
        level_hpa = -1
        level_type = "tropopause"
    else:
        level_hpa = eccodes.codes_get(msgid, "level")
        level_type = "isobaricInhPa"

    ni = eccodes.codes_get(msgid, "Ni")
    nj = eccodes.codes_get(msgid, "Nj")
    values = eccodes.codes_get_array(msgid, "values").astype(np.float32)

    valid_time = run_time + timedelta(hours=forecast_hour)

    return {
        "download_id": download_id,
        "run_time": run_time,
        "forecast_hour": forecast_hour,
        "valid_time": valid_time,
        "parameter": parameter,
        "level_hpa": level_hpa,
        "level_type": level_type,
        "ni": ni,
        "nj": nj,
        "lat_first": eccodes.codes_get(msgid, "latitudeOfFirstGridPointInDegrees"),
        "lon_first": eccodes.codes_get(msgid, "longitudeOfFirstGridPointInDegrees"),
        "lat_last": eccodes.codes_get(msgid, "latitudeOfLastGridPointInDegrees"),
        "lon_last": eccodes.codes_get(msgid, "longitudeOfLastGridPointInDegrees"),
        "d_lat": eccodes.codes_get(msgid, "jDirectionIncrementInDegrees"),
        "d_lon": eccodes.codes_get(msgid, "iDirectionIncrementInDegrees"),
        "values": values.tobytes(),
    }
```

- [ ] **Step 3: Commit**

```bash
cd /Users/greg/Development/cirrus
git add services/decoder/src/cirrus/decoder/grib_decoder.py services/decoder/pyproject.toml
git commit -m "feat(decoder): GRIB2 decoding module using ecCodes"
```

---

## Task 8: Decoder — Database Operations

**Files:**
- Create: `services/decoder/src/cirrus/decoder/db.py`

- [ ] **Step 1: Create db.py**

Create `services/decoder/src/cirrus/decoder/db.py`:

```python
"""Database operations for the decoder service."""

import logging

import psycopg

logger = logging.getLogger(__name__)


def get_download_info(conn: psycopg.Connection, download_id: int) -> dict | None:
    """Look up a grib_downloads row by ID. Returns dict with run_time and forecast_hour."""
    row = conn.execute(
        "SELECT run_time, forecast_hour FROM grib_downloads WHERE id = %s",
        (download_id,),
    ).fetchone()
    if row is None:
        return None
    return {"run_time": row[0], "forecast_hour": row[1]}


def insert_fields(conn: psycopg.Connection, fields: list[dict]) -> int:
    """Insert decoded fields into gridded_fields table.

    Uses ON CONFLICT DO UPDATE for idempotent re-processing.
    Returns the number of rows inserted/updated.
    """
    if not fields:
        return 0

    sql = """
        INSERT INTO gridded_fields (
            download_id, run_time, forecast_hour, valid_time,
            parameter, level_hpa, level_type,
            ni, nj, lat_first, lon_first, lat_last, lon_last, d_lat, d_lon,
            values
        ) VALUES (
            %(download_id)s, %(run_time)s, %(forecast_hour)s, %(valid_time)s,
            %(parameter)s, %(level_hpa)s, %(level_type)s,
            %(ni)s, %(nj)s, %(lat_first)s, %(lon_first)s, %(lat_last)s, %(lon_last)s,
            %(d_lat)s, %(d_lon)s, %(values)s
        )
        ON CONFLICT (run_time, forecast_hour, parameter, level_hpa, level_type)
        DO UPDATE SET
            download_id = EXCLUDED.download_id,
            valid_time = EXCLUDED.valid_time,
            ni = EXCLUDED.ni, nj = EXCLUDED.nj,
            lat_first = EXCLUDED.lat_first, lon_first = EXCLUDED.lon_first,
            lat_last = EXCLUDED.lat_last, lon_last = EXCLUDED.lon_last,
            d_lat = EXCLUDED.d_lat, d_lon = EXCLUDED.d_lon,
            values = EXCLUDED.values,
            ingested_at = NOW()
    """

    with conn.transaction():
        cur = conn.cursor()
        cur.executemany(sql, fields)
    return len(fields)


def mark_decoded(conn: psycopg.Connection, download_id: int) -> None:
    """Mark a download as decoded and notify listeners."""
    with conn.transaction():
        conn.execute(
            "UPDATE grib_downloads SET decoded = TRUE WHERE id = %s",
            (download_id,),
        )
        conn.execute("NOTIFY gridded_data_updated")
```

- [ ] **Step 2: Commit**

```bash
cd /Users/greg/Development/cirrus
git add services/decoder/src/cirrus/decoder/db.py
git commit -m "feat(decoder): database operations for field insertion and download tracking"
```

---

## Task 9: Decoder — Update Main Entry Point

**Files:**
- Modify: `services/decoder/src/cirrus/decoder/main.py`

- [ ] **Step 1: Rewrite main.py**

Replace `services/decoder/src/cirrus/decoder/main.py` with the full service that handles NOTIFY events:

```python
import json
import logging
import os
from http.server import HTTPServer, BaseHTTPRequestHandler
from threading import Thread

import psycopg

from cirrus.decoder import db, grib_decoder

SERVICE_NAME = "decoder"
PORT = 8090
logger = logging.getLogger(SERVICE_NAME)


class HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"status": "ok", "service": "decoder"}')
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass


def start_health_server():
    server = HTTPServer(("0.0.0.0", PORT), HealthHandler)
    server.serve_forever()


def handle_notification(conn: psycopg.Connection, payload: str) -> None:
    """Process a single decoder_jobs notification."""
    try:
        data = json.loads(payload)
    except json.JSONDecodeError:
        logger.error("Invalid JSON in notification payload: %s", payload)
        return

    download_id = data.get("download_id")
    file_path = data.get("file_path")
    if download_id is None or file_path is None:
        logger.error("Missing fields in notification payload: %s", payload)
        return

    logger.info("Processing download_id=%d file=%s", download_id, file_path)

    # Look up run_time and forecast_hour from the database
    info = db.get_download_info(conn, download_id)
    if info is None:
        logger.error("Download ID %d not found in database", download_id)
        return

    # Check file exists
    if not os.path.exists(file_path):
        logger.error("GRIB2 file not found: %s", file_path)
        return

    # Decode the GRIB2 file
    fields = grib_decoder.decode_file(
        file_path, download_id, info["run_time"], info["forecast_hour"]
    )

    if not fields:
        logger.warning("No fields decoded from %s", file_path)
        return

    # Insert into database
    count = db.insert_fields(conn, fields)
    logger.info("Inserted %d field(s) for download_id=%d", count, download_id)

    # Mark as decoded and notify
    db.mark_decoded(conn, download_id)
    logger.info("Marked download_id=%d as decoded", download_id)


def main():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )

    database_url = os.environ["DATABASE_URL"]

    conn = psycopg.connect(database_url, autocommit=True)
    logger.info("%s connected to database", SERVICE_NAME)

    # Start health check server in background thread
    health_thread = Thread(target=start_health_server, daemon=True)
    health_thread.start()
    logger.info("%s health server on port %d", SERVICE_NAME, PORT)

    # Listen for notifications
    conn.execute("LISTEN decoder_jobs")
    logger.info("%s listening for notifications on decoder_jobs", SERVICE_NAME)

    # Also process any un-decoded downloads from before this process started
    unprocessed = conn.execute(
        "SELECT id, file_path FROM grib_downloads WHERE decoded = FALSE ORDER BY id"
    ).fetchall()
    for row in unprocessed:
        download_id, file_path = row
        logger.info("Processing backlog: download_id=%d", download_id)
        handle_notification(conn, json.dumps({"download_id": download_id, "file_path": file_path}))

    # Main notification loop
    while True:
        gen = conn.notifies(timeout=5.0)
        for notify in gen:
            handle_notification(conn, notify.payload)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Commit**

```bash
cd /Users/greg/Development/cirrus
git add services/decoder/src/cirrus/decoder/main.py
git commit -m "feat(decoder): NOTIFY handler with GRIB2 decode and ingest pipeline"
```

---

## Task 10: Docker Compose & Environment Updates

**Files:**
- Modify: `docker-compose.yml`
- Modify: `.env.example`

- [ ] **Step 1: Add new environment variables to .env.example**

Append to `.env.example`:

```env
# Acquisition service
NOMADS_BASE_URL=https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl
POLL_INTERVAL_SECS=300
RETENTION_HOURS=48
GRIB_STORE_PATH=/data/grib
```

- [ ] **Step 2: Update docker-compose.yml**

Update the `acquisition` service to expose port 8081 (for `POST /api/fetch`) and add the new environment variables:

```yaml
  acquisition:
    ...
    ports:
      - "8081:8081"
    environment:
      DATABASE_URL: ${DATABASE_URL}
      NOMADS_BASE_URL: ${NOMADS_BASE_URL:-https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl}
      POLL_INTERVAL_SECS: ${POLL_INTERVAL_SECS:-300}
      RETENTION_HOURS: ${RETENTION_HOURS:-48}
      GRIB_STORE_PATH: ${GRIB_STORE_PATH:-/data/grib}
```

The `decoder` service does not need additional environment variables — it receives file paths via the NOTIFY payload. No changes needed to the decoder compose block.

- [ ] **Step 3: Copy updated .env.example to .env**

```bash
cp .env.example .env
```

- [ ] **Step 4: Commit**

```bash
cd /Users/greg/Development/cirrus
git add docker-compose.yml .env.example
git commit -m "feat: add acquisition and decoder env vars to compose and env template"
```

---

## Task 11: Integration Smoke Test

This task rebuilds and runs the full stack to verify the end-to-end pipeline works.

- [ ] **Step 1: Wipe Postgres volume (to apply new migration)**

```bash
cd /Users/greg/Development/cirrus
docker compose down -v
```

- [ ] **Step 2: Rebuild acquisition and decoder images**

```bash
docker compose build acquisition decoder
```

- [ ] **Step 3: Start the full stack**

```bash
docker compose up -d
```

Wait for all services to be healthy:

```bash
docker compose ps
```

- [ ] **Step 4: Trigger an on-demand fetch**

```bash
curl http://localhost:8081/health  # verify acquisition is reachable
curl -X POST http://localhost:8081/api/fetch
```

Expected: health returns `{"status":"ok","service":"acquisition"}`, fetch returns JSON like `{"status":"started","run_time":"2026-03-21T12:00:00+00:00","forecast_hours":11}`

- [ ] **Step 5: Watch the logs**

```bash
docker compose logs -f acquisition decoder
```

Expected: acquisition logs showing downloads from NOMADS, decoder logs showing GRIB2 decoding and field insertion. This may take several minutes for 11 forecast hours.

- [ ] **Step 6: Verify data in Postgres**

```bash
docker compose exec postgres psql -U cirrus -d cirrus -c "SELECT count(*) FROM grib_downloads WHERE decoded = TRUE;"
docker compose exec postgres psql -U cirrus -d cirrus -c "SELECT parameter, level_hpa, count(*) FROM gridded_fields GROUP BY parameter, level_hpa ORDER BY parameter, level_hpa;"
```

Expected: `grib_downloads` shows decoded rows, `gridded_fields` shows fields grouped by parameter and level across all downloaded forecast hours.

- [ ] **Step 7: Tear down**

```bash
docker compose down
```

- [ ] **Step 8: Fix any issues and commit**

If any issues were found, fix them and commit:

```bash
git add -A
git commit -m "fix: address issues found during pipeline integration test"
```
