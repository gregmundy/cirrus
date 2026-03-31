use axum::{
    extract::{Query, State},
    http::StatusCode,
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Deserialize)]
pub struct TextQuery {
    #[serde(rename = "type")]
    report_type: Option<String>,
    station: Option<String>,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct TextReport {
    report_type: String,
    station: Option<String>,
    fir_name: Option<String>,
    issue_time: Option<DateTime<Utc>>,
    valid_from: Option<DateTime<Utc>>,
    valid_to: Option<DateTime<Utc>>,
    raw_text: String,
    hazard: Option<String>,
    qualifier: Option<String>,
}

#[derive(Serialize)]
pub struct TextResponse {
    reports: Vec<TextReport>,
}

pub async fn get_opmet_text(
    State(pool): State<PgPool>,
    Query(params): Query<TextQuery>,
) -> Result<Json<TextResponse>, StatusCode> {
    // Build query with optional filters. We keep it simple with runtime
    // branching rather than a query builder to avoid a dependency.
    let reports = match (&params.report_type, &params.station) {
        (Some(rtype), Some(station)) => {
            sqlx::query_as::<_, TextReport>(
                "SELECT report_type, station, fir_name, issue_time, valid_from, valid_to,
                        raw_text, hazard, qualifier
                 FROM opmet_text_reports
                 WHERE report_type = $1
                   AND station = $2
                   AND (valid_to IS NULL OR valid_to > NOW() - INTERVAL '1 hour')
                 ORDER BY valid_from DESC NULLS LAST
                 LIMIT 500",
            )
            .bind(rtype)
            .bind(station)
            .fetch_all(&pool)
            .await
        }
        (Some(rtype), None) => {
            sqlx::query_as::<_, TextReport>(
                "SELECT report_type, station, fir_name, issue_time, valid_from, valid_to,
                        raw_text, hazard, qualifier
                 FROM opmet_text_reports
                 WHERE report_type = $1
                   AND (valid_to IS NULL OR valid_to > NOW() - INTERVAL '1 hour')
                 ORDER BY valid_from DESC NULLS LAST
                 LIMIT 500",
            )
            .bind(rtype)
            .fetch_all(&pool)
            .await
        }
        (None, Some(station)) => {
            sqlx::query_as::<_, TextReport>(
                "SELECT report_type, station, fir_name, issue_time, valid_from, valid_to,
                        raw_text, hazard, qualifier
                 FROM opmet_text_reports
                 WHERE station = $1
                   AND (valid_to IS NULL OR valid_to > NOW() - INTERVAL '1 hour')
                 ORDER BY valid_from DESC NULLS LAST
                 LIMIT 500",
            )
            .bind(station)
            .fetch_all(&pool)
            .await
        }
        (None, None) => {
            sqlx::query_as::<_, TextReport>(
                "SELECT report_type, station, fir_name, issue_time, valid_from, valid_to,
                        raw_text, hazard, qualifier
                 FROM opmet_text_reports
                 WHERE valid_to IS NULL OR valid_to > NOW() - INTERVAL '1 hour'
                 ORDER BY valid_from DESC NULLS LAST
                 LIMIT 500",
            )
            .fetch_all(&pool)
            .await
        }
    }
    .map_err(|e| {
        tracing::error!("Failed to query opmet_text_reports: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(TextResponse { reports }))
}
