use chrono::{DateTime, Duration, Utc};
use sqlx::PgPool;

/// Check which forecast hours are already downloaded for a given cycle.
pub async fn downloaded_forecast_hours(
    pool: &PgPool,
    run_time: DateTime<Utc>,
) -> Result<Vec<i32>, sqlx::Error> {
    let rows = sqlx::query_scalar::<_, i32>(
        "SELECT forecast_hour FROM grib_downloads WHERE run_time = $1",
    )
    .bind(run_time)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Record a successful download in the database and notify the decoder.
///
/// The INSERT and pg_notify happen in the same transaction so the decoder
/// never receives a notification for a row that doesn't exist yet.
///
/// Returns the inserted download ID.
pub async fn record_download(
    pool: &PgPool,
    run_time: DateTime<Utc>,
    forecast_hour: u32,
    source_url: &str,
    file_path: &str,
    file_size: u64,
) -> Result<i64, sqlx::Error> {
    let mut tx = pool.begin().await?;

    let id: i64 = sqlx::query_scalar(
        "INSERT INTO grib_downloads (run_time, forecast_hour, source_url, file_path, file_size)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (run_time, forecast_hour) DO UPDATE
           SET source_url = EXCLUDED.source_url,
               file_path = EXCLUDED.file_path,
               file_size = EXCLUDED.file_size,
               downloaded_at = NOW(),
               decoded = FALSE
         RETURNING id",
    )
    .bind(run_time)
    .bind(forecast_hour as i32)
    .bind(source_url)
    .bind(file_path)
    .bind(file_size as i64)
    .fetch_one(&mut *tx)
    .await?;

    let payload = serde_json::json!({
        "download_id": id,
        "file_path": file_path
    })
    .to_string();

    sqlx::query("SELECT pg_notify('decoder_jobs', $1)")
        .bind(&payload)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;

    Ok(id)
}

/// Delete downloads (and cascading gridded_fields) older than retention_hours.
///
/// Returns file paths of deleted downloads so the caller can remove files from disk.
pub async fn cleanup_old_downloads(
    pool: &PgPool,
    retention_hours: i64,
) -> Result<Vec<String>, sqlx::Error> {
    let cutoff = Utc::now() - Duration::hours(retention_hours);

    let paths: Vec<String> =
        sqlx::query_scalar("DELETE FROM grib_downloads WHERE run_time < $1 RETURNING file_path")
            .bind(cutoff)
            .fetch_all(pool)
            .await?;

    Ok(paths)
}
