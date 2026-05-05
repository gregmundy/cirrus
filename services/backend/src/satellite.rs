use axum::{extract::Path, http::StatusCode, Json};
use serde::Serialize;
use std::path;

#[derive(Serialize)]
pub struct SatelliteResponse {
    channel: u32,
    channel_name: String,
    units: String,
    timestamp: String,
    ni: usize,
    nj: usize,
    lat_first: f64,
    lon_first: f64,
    d_lat: f64,
    d_lon: f64,
    value_min: f64,
    value_max: f64,
    values: Vec<f32>,
}

#[derive(serde::Deserialize)]
struct SatelliteFile {
    channel: u32,
    channel_name: String,
    units: String,
    timestamp: String,
    ni: usize,
    nj: usize,
    lat_first: f64,
    lon_first: f64,
    d_lat: f64,
    d_lon: f64,
    value_min: f64,
    value_max: f64,
    values: String, // hex-encoded f32 bytes
}

pub async fn get_satellite(
    Path(channel): Path<u32>,
) -> Result<Json<SatelliteResponse>, StatusCode> {
    let data_dir =
        std::env::var("SATELLITE_DATA_DIR").unwrap_or_else(|_| "/data/satellite".to_string());
    let file_path = path::Path::new(&data_dir).join(format!("ch{:02}.json", channel));

    if !file_path.exists() {
        return Err(StatusCode::NOT_FOUND);
    }

    let content = tokio::fs::read_to_string(&file_path)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let file: SatelliteFile =
        serde_json::from_str(&content).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Decode hex-encoded f32 bytes
    let bytes = hex::decode(&file.values).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let values: Vec<f32> = bytes
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect();

    Ok(Json(SatelliteResponse {
        channel: file.channel,
        channel_name: file.channel_name,
        units: file.units,
        timestamp: file.timestamp,
        ni: file.ni,
        nj: file.nj,
        lat_first: file.lat_first,
        lon_first: file.lon_first,
        d_lat: file.d_lat,
        d_lon: file.d_lon,
        value_min: file.value_min,
        value_max: file.value_max,
        values,
    }))
}
