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
