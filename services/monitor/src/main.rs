use axum::{routing::get, Json, Router};
use serde_json::{json, Value};
use sqlx::postgres::PgPoolOptions;
use std::env;

const SERVICE_NAME: &str = "monitor";
const PORT: u16 = 8083;

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
        .max_connections(2)
        .connect(&database_url)
        .await
        .expect("Failed to connect to database");

    let _conn = pool.acquire().await.expect("Failed to acquire connection");
    tracing::info!("{SERVICE_NAME} connected to database");

    let app = Router::new().route("/health", get(health));

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{PORT}"))
        .await
        .expect("Failed to bind");
    tracing::info!("{SERVICE_NAME} listening on port {PORT}");

    axum::serve(listener, app).await.expect("Server error");
}
