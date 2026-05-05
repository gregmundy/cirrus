use axum::{
    extract::{Query, State},
    http::StatusCode,
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Deserialize)]
pub struct SigwxQuery {
    valid_time: Option<DateTime<Utc>>,
}

#[derive(Serialize)]
pub struct SigwxResponse {
    valid_time: DateTime<Utc>,
    originating_centre: String,
    feature_count: usize,
    features: Vec<serde_json::Value>,
}

#[derive(sqlx::FromRow)]
struct SigwxRow {
    valid_time: DateTime<Utc>,
    originating_centre: String,
    geojson: serde_json::Value,
}

pub async fn get_sigwx(
    State(pool): State<PgPool>,
    Query(params): Query<SigwxQuery>,
) -> Result<Json<SigwxResponse>, StatusCode> {
    let valid_time = match params.valid_time {
        Some(vt) => vt,
        None => sqlx::query_scalar::<_, DateTime<Utc>>(
            "SELECT DISTINCT valid_time FROM sigwx_features ORDER BY valid_time DESC LIMIT 1",
        )
        .fetch_optional(&pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?,
    };

    let rows = sqlx::query_as::<_, SigwxRow>(
        "SELECT valid_time, originating_centre, geojson FROM sigwx_features WHERE valid_time = $1 ORDER BY phenomenon",
    )
    .bind(valid_time)
    .fetch_all(&pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if rows.is_empty() {
        return Err(StatusCode::NOT_FOUND);
    }

    let originating_centre = rows[0].originating_centre.clone();
    let features: Vec<serde_json::Value> = rows.into_iter().map(|r| r.geojson).collect();
    let feature_count = features.len();

    Ok(Json(SigwxResponse {
        valid_time,
        originating_centre,
        feature_count,
        features,
    }))
}
