use axum::{
    extract::{Query, State},
    http::StatusCode,
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Deserialize)]
pub struct GriddedQuery {
    parameter: String,
    level_hpa: i32,
    forecast_hour: i32,
    run_time: Option<DateTime<Utc>>,
    thin: Option<usize>,
    level_type: Option<String>,
}

#[derive(Serialize)]
pub struct GriddedResponse {
    parameter: String,
    run_time: DateTime<Utc>,
    forecast_hour: i32,
    valid_time: DateTime<Utc>,
    level_hpa: i32,
    ni: usize,
    nj: usize,
    lats: Vec<f32>,
    lons: Vec<f32>,
    values: Vec<f32>,
}

#[derive(sqlx::FromRow)]
struct GridRow {
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

pub async fn get_gridded(
    State(pool): State<PgPool>,
    Query(params): Query<GriddedQuery>,
) -> Result<Json<GriddedResponse>, StatusCode> {
    let thin = params.thin.unwrap_or(2).max(1);

    // Resolve run_time
    let run_time = match params.run_time {
        Some(rt) => rt,
        None => sqlx::query_scalar::<_, DateTime<Utc>>(
            "SELECT run_time FROM gridded_fields ORDER BY run_time DESC LIMIT 1",
        )
        .fetch_optional(&pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?,
    };

    // Fetch the gridded field
    let row = if let Some(ref lt) = params.level_type {
        sqlx::query_as::<_, GridRow>(
            "SELECT run_time, valid_time, ni, nj, lat_first, lat_last, lon_first, d_lat, d_lon, values \
             FROM gridded_fields \
             WHERE parameter = $1 AND level_hpa = $2 AND forecast_hour = $3 AND run_time = $4 AND level_type = $5"
        )
        .bind(&params.parameter)
        .bind(params.level_hpa)
        .bind(params.forecast_hour)
        .bind(run_time)
        .bind(lt)
        .fetch_optional(&pool)
        .await
    } else {
        sqlx::query_as::<_, GridRow>(
            "SELECT run_time, valid_time, ni, nj, lat_first, lat_last, lon_first, d_lat, d_lon, values \
             FROM gridded_fields \
             WHERE parameter = $1 AND level_hpa = $2 AND forecast_hour = $3 AND run_time = $4"
        )
        .bind(&params.parameter)
        .bind(params.level_hpa)
        .bind(params.forecast_hour)
        .bind(run_time)
        .fetch_optional(&pool)
        .await
    }
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .ok_or(StatusCode::NOT_FOUND)?;

    let raw_ni = row.ni as usize;
    let raw_nj = row.nj as usize;

    // Decode BYTEA to f32 array
    let all_values: Vec<f32> = row
        .values
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect();

    // Compute effective d_lat (negate for N→S grids)
    let d_lat = if row.lat_first > row.lat_last {
        -row.d_lat.abs()
    } else {
        row.d_lat.abs()
    };

    // Build thinned 1D axis arrays and values
    let mut lats = Vec::new();
    let mut lons = Vec::new();
    let mut values = Vec::new();

    // Compute thinned lat array
    let mut j_indices = Vec::new();
    let mut j = 0usize;
    while j < raw_nj {
        lats.push((row.lat_first + (j as f64) * d_lat) as f32);
        j_indices.push(j);
        j += thin;
    }

    // Compute thinned lon indices and values, reordered so lons are
    // monotonically increasing from -180 to ~180. The raw GFS grid starts
    // at lon 0, so we find the split point where lon > 180 and rotate.
    let mut raw_i_indices = Vec::new();
    let mut raw_lons = Vec::new();
    let mut i = 0usize;
    while i < raw_ni {
        let lon = row.lon_first + (i as f64) * row.d_lon;
        raw_i_indices.push(i);
        raw_lons.push(lon);
        i += thin;
    }

    // Find the split point: first index where lon > 180
    let split = raw_lons
        .iter()
        .position(|&lon| lon > 180.0)
        .unwrap_or(raw_lons.len());

    // Reorder: [split..end] (wrapped to negative) then [0..split]
    let mut i_indices = Vec::new();
    for idx in split..raw_lons.len() {
        lons.push((raw_lons[idx] - 360.0) as f32);
        i_indices.push(raw_i_indices[idx]);
    }
    for idx in 0..split {
        lons.push(raw_lons[idx] as f32);
        i_indices.push(raw_i_indices[idx]);
    }

    let out_ni = i_indices.len();
    let out_nj = j_indices.len();

    // Extract thinned values in row-major order (j outer, i inner)
    // using the reordered column indices
    for &jj in &j_indices {
        for &ii in &i_indices {
            let idx = jj * raw_ni + ii;
            if idx < all_values.len() {
                values.push(all_values[idx]);
            }
        }
    }

    Ok(Json(GriddedResponse {
        parameter: params.parameter,
        run_time,
        forecast_hour: params.forecast_hour,
        valid_time: row.valid_time,
        level_hpa: params.level_hpa,
        ni: out_ni,
        nj: out_nj,
        lats,
        lons,
        values,
    }))
}
