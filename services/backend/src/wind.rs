use axum::{
    extract::{Query, State},
    http::StatusCode,
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Deserialize)]
pub struct WindQuery {
    level_hpa: i32,
    forecast_hour: i32,
    run_time: Option<DateTime<Utc>>,
    thin: Option<usize>,
}

#[derive(Serialize)]
pub struct WindResponse {
    run_time: DateTime<Utc>,
    forecast_hour: i32,
    valid_time: DateTime<Utc>,
    level_hpa: i32,
    count: usize,
    lats: Vec<f32>,
    lons: Vec<f32>,
    speeds: Vec<f32>,
    directions: Vec<f32>,
}

#[derive(sqlx::FromRow)]
struct GriddedRow {
    run_time: DateTime<Utc>,
    valid_time: DateTime<Utc>,
    ni: i32,
    nj: i32,
    lat_first: f64,
    lon_first: f64,
    d_lat: f64,
    d_lon: f64,
    values: Vec<u8>,
}

pub async fn get_wind(
    State(pool): State<PgPool>,
    Query(params): Query<WindQuery>,
) -> Result<Json<WindResponse>, StatusCode> {
    let thin = params.thin.unwrap_or(4).max(1);

    // Resolve run_time
    let run_time = match params.run_time {
        Some(rt) => rt,
        None => {
            sqlx::query_scalar::<_, DateTime<Utc>>(
                "SELECT DISTINCT run_time FROM gridded_fields ORDER BY run_time DESC LIMIT 1"
            )
            .fetch_optional(&pool)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
            .ok_or(StatusCode::NOT_FOUND)?
        }
    };

    // Fetch UGRD
    let u_row = sqlx::query_as::<_, GriddedRow>(
        "SELECT run_time, valid_time, ni, nj, lat_first, lon_first, d_lat, d_lon, values \
         FROM gridded_fields \
         WHERE parameter = 'UGRD' AND level_hpa = $1 AND forecast_hour = $2 AND run_time = $3"
    )
    .bind(params.level_hpa)
    .bind(params.forecast_hour)
    .bind(run_time)
    .fetch_optional(&pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .ok_or(StatusCode::NOT_FOUND)?;

    // Fetch VGRD
    let v_row = sqlx::query_as::<_, GriddedRow>(
        "SELECT run_time, valid_time, ni, nj, lat_first, lon_first, d_lat, d_lon, values \
         FROM gridded_fields \
         WHERE parameter = 'VGRD' AND level_hpa = $1 AND forecast_hour = $2 AND run_time = $3"
    )
    .bind(params.level_hpa)
    .bind(params.forecast_hour)
    .bind(run_time)
    .fetch_optional(&pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .ok_or(StatusCode::NOT_FOUND)?;

    // Decode BYTEA to f32 arrays
    let u_vals = bytes_to_f32(&u_row.values);
    let v_vals = bytes_to_f32(&v_row.values);

    let ni = u_row.ni as usize;
    let nj = u_row.nj as usize;

    // Build thinned output arrays
    let mut lats = Vec::new();
    let mut lons = Vec::new();
    let mut speeds = Vec::new();
    let mut directions = Vec::new();

    for j in (0..nj).step_by(thin) {
        for i in (0..ni).step_by(thin) {
            let idx = j * ni + i;
            if idx >= u_vals.len() || idx >= v_vals.len() {
                continue;
            }

            let u = u_vals[idx] as f64;
            let v = v_vals[idx] as f64;

            let lat = u_row.lat_first + (j as f64) * u_row.d_lat;
            // Handle grids that go N→S (d_lat negative) vs S→N
            let lon = u_row.lon_first + (i as f64) * u_row.d_lon;

            let speed_ms = (u * u + v * v).sqrt();
            let speed_kt = (speed_ms * 1.94384) as f32;
            let dir = ((270.0 - v.atan2(u).to_degrees()).rem_euclid(360.0)) as f32;

            lats.push(lat as f32);
            lons.push(lon as f32);
            speeds.push(speed_kt);
            directions.push(dir);
        }
    }

    Ok(Json(WindResponse {
        run_time,
        forecast_hour: params.forecast_hour,
        valid_time: u_row.valid_time,
        level_hpa: params.level_hpa,
        count: lats.len(),
        lats,
        lons,
        speeds,
        directions,
    }))
}

/// Reinterpret a byte slice as a Vec<f32> (little-endian).
fn bytes_to_f32(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect()
}
