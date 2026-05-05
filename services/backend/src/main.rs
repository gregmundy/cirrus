mod gridded;
mod maxwind;
mod meta;
mod opmet;
mod opmet_text;
mod satellite;
mod sigwx;
mod wind;

use axum::{routing::get, Json, Router};
use serde_json::{json, Value};
use sqlx::postgres::PgPoolOptions;
use std::env;

const SERVICE_NAME: &str = "backend";
const PORT: u16 = 8080;

async fn health() -> Json<Value> {
    Json(json!({"status": "ok", "service": SERVICE_NAME}))
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    let database_url = env::var("DATABASE_URL").expect("DATABASE_URL must be set");

    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(&database_url)
        .await
        .expect("Failed to connect to database");

    let _conn = pool.acquire().await.expect("Failed to acquire connection");
    tracing::info!("{SERVICE_NAME} connected to database");

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/wind", get(wind::get_wind))
        .route("/api/gridded", get(gridded::get_gridded))
        .route("/api/gridded/meta", get(meta::get_meta))
        .route("/api/maxwind", get(maxwind::get_maxwind))
        .route("/api/opmet/stations", get(opmet::get_stations))
        .route("/api/opmet/text", get(opmet_text::get_opmet_text))
        .route("/api/sigwx", get(sigwx::get_sigwx))
        .route("/api/satellite/{channel}", get(satellite::get_satellite))
        .with_state(pool);

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{PORT}"))
        .await
        .expect("Failed to bind");
    tracing::info!("{SERVICE_NAME} listening on port {PORT}");

    axum::serve(listener, app).await.expect("Server error");
}
