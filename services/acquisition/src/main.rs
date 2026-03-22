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

#[derive(serde::Deserialize)]
struct FetchParams {
    run_time: Option<DateTime<Utc>>,
}

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
