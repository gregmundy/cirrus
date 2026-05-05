use axum::{
    extract::{Query, State},
    http::StatusCode,
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Deserialize)]
pub struct MaxWindQuery {
    forecast_hour: i32,
    run_time: Option<DateTime<Utc>>,
    thin: Option<usize>,
}

#[derive(Serialize)]
pub struct MaxWindResponse {
    run_time: DateTime<Utc>,
    forecast_hour: i32,
    valid_time: DateTime<Utc>,
    count: usize,
    lats: Vec<f32>,
    lons: Vec<f32>,
    speeds: Vec<f32>,
    directions: Vec<f32>,
    flight_levels: Vec<f32>,
}

#[derive(sqlx::FromRow)]
struct GriddedRow {
    run_time: DateTime<Utc>,
    valid_time: DateTime<Utc>,
    ni: i32,
    nj: i32,
    lat_first: f64,
    lat_last: f64,
    lon_first: f64,
    d_lat: f64,
    d_lon: f64,
    values: Vec<u8>,
}

const MAXWIND_QUERY: &str =
    "SELECT run_time, valid_time, ni, nj, lat_first, lat_last, lon_first, d_lat, d_lon, values \
     FROM gridded_fields \
     WHERE parameter = $1 AND level_hpa = -1 AND level_type = 'maxwind' \
     AND forecast_hour = $2 AND run_time = $3";

pub async fn get_maxwind(
    State(pool): State<PgPool>,
    Query(params): Query<MaxWindQuery>,
) -> Result<Json<MaxWindResponse>, StatusCode> {
    let thin = params.thin.unwrap_or(4).max(1);

    // Resolve run_time
    let run_time = match params.run_time {
        Some(rt) => rt,
        None => sqlx::query_scalar::<_, DateTime<Utc>>(
            "SELECT DISTINCT run_time FROM gridded_fields ORDER BY run_time DESC LIMIT 1",
        )
        .fetch_optional(&pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?,
    };

    // Fetch UGRD, VGRD, PRES at maxwind level
    let u_row = sqlx::query_as::<_, GriddedRow>(MAXWIND_QUERY)
        .bind("UGRD")
        .bind(params.forecast_hour)
        .bind(run_time)
        .fetch_optional(&pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;

    let v_row = sqlx::query_as::<_, GriddedRow>(MAXWIND_QUERY)
        .bind("VGRD")
        .bind(params.forecast_hour)
        .bind(run_time)
        .fetch_optional(&pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;

    let p_row = sqlx::query_as::<_, GriddedRow>(MAXWIND_QUERY)
        .bind("PRES")
        .bind(params.forecast_hour)
        .bind(run_time)
        .fetch_optional(&pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;

    let u_vals = bytes_to_f32(&u_row.values);
    let v_vals = bytes_to_f32(&v_row.values);
    let p_vals = bytes_to_f32(&p_row.values);

    let ni = u_row.ni as usize;
    let nj = u_row.nj as usize;

    let d_lat = if u_row.lat_first > u_row.lat_last {
        -u_row.d_lat.abs()
    } else {
        u_row.d_lat.abs()
    };
    let d_lon = u_row.d_lon;

    let mut lats = Vec::new();
    let mut lons = Vec::new();
    let mut speeds = Vec::new();
    let mut directions = Vec::new();
    let mut flight_levels = Vec::new();

    for j in (0..nj).step_by(thin) {
        for i in (0..ni).step_by(thin) {
            let idx = j * ni + i;
            if idx >= u_vals.len() || idx >= v_vals.len() || idx >= p_vals.len() {
                continue;
            }

            let u = u_vals[idx] as f64;
            let v = v_vals[idx] as f64;
            let pres_pa = p_vals[idx] as f64;

            let lat = u_row.lat_first + (j as f64) * d_lat;
            let mut lon = u_row.lon_first + (i as f64) * d_lon;
            if lon > 180.0 {
                lon -= 360.0;
            }

            let speed_ms = (u * u + v * v).sqrt();
            let speed_kt = (speed_ms * 1.94384) as f32;
            let dir = ((270.0 - v.atan2(u).to_degrees()).rem_euclid(360.0)) as f32;

            // Convert pressure (Pa) to flight level
            // FL = (1 - (P/101325)^0.190284) * 145366.45 / 100
            let fl = ((1.0 - (pres_pa / 101325.0).powf(0.190284)) * 145366.45 / 100.0) as f32;

            lats.push(lat as f32);
            lons.push(lon as f32);
            speeds.push(speed_kt);
            directions.push(dir);
            flight_levels.push(fl);
        }
    }

    Ok(Json(MaxWindResponse {
        run_time,
        forecast_hour: params.forecast_hour,
        valid_time: u_row.valid_time,
        count: lats.len(),
        lats,
        lons,
        speeds,
        directions,
        flight_levels,
    }))
}

fn bytes_to_f32(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect()
}
