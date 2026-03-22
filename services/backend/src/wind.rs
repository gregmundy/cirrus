use axum::{extract::State, Json};
use serde_json::Value;
use sqlx::PgPool;

pub async fn get_wind(State(_pool): State<PgPool>) -> Json<Value> {
    Json(serde_json::json!({"error": "not implemented"}))
}
