use axum::{extract::State, Json};
use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::PgPool;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Serialize)]
pub struct MetaResponse {
    runs: Vec<RunMeta>,
}

#[derive(Serialize)]
pub struct RunMeta {
    run_time: DateTime<Utc>,
    forecast_hours: Vec<i32>,
    parameters: Vec<String>,
    levels: Vec<i32>,
}

#[derive(sqlx::FromRow)]
struct FieldMeta {
    run_time: DateTime<Utc>,
    forecast_hour: i32,
    parameter: String,
    level_hpa: i32,
}

pub async fn get_meta(State(pool): State<PgPool>) -> Json<MetaResponse> {
    let rows = sqlx::query_as::<_, FieldMeta>(
        "SELECT DISTINCT run_time, forecast_hour, parameter, level_hpa \
         FROM gridded_fields \
         ORDER BY run_time DESC, forecast_hour, parameter, level_hpa"
    )
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    // Group by run_time
    let mut runs_map: BTreeMap<DateTime<Utc>, (BTreeSet<i32>, BTreeSet<String>, BTreeSet<i32>)> =
        BTreeMap::new();

    // Track which levels have both UGRD and VGRD per run.
    // Note: filtering is per-run, not per-(run, forecast_hour). GFS data is highly
    // regular — if a level exists for any hour, it exists for all hours in that run.
    let mut wind_levels: BTreeMap<(DateTime<Utc>, i32), BTreeSet<String>> = BTreeMap::new();

    for row in &rows {
        let entry = runs_map.entry(row.run_time).or_default();
        entry.0.insert(row.forecast_hour);
        entry.1.insert(row.parameter.clone());
        entry.2.insert(row.level_hpa);

        if row.parameter == "UGRD" || row.parameter == "VGRD" {
            wind_levels
                .entry((row.run_time, row.level_hpa))
                .or_default()
                .insert(row.parameter.clone());
        }
    }

    // Only include levels where both UGRD and VGRD exist
    let runs: Vec<RunMeta> = runs_map
        .into_iter()
        .rev() // most recent first
        .map(|(run_time, (hours, params, _all_levels))| {
            let levels: Vec<i32> = _all_levels
                .into_iter()
                .filter(|&lev| {
                    wind_levels
                        .get(&(run_time, lev))
                        .map(|p| p.contains("UGRD") && p.contains("VGRD"))
                        .unwrap_or(false)
                })
                .collect();
            RunMeta {
                run_time,
                forecast_hours: hours.into_iter().collect(),
                parameters: params.into_iter().collect(),
                levels,
            }
        })
        .collect();

    Json(MetaResponse { runs })
}
