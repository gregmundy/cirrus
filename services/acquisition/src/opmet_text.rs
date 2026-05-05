use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json;
use sqlx::PgPool;

// AWC TAF JSON response shape
#[derive(Deserialize)]
struct TafEntry {
    #[serde(rename = "icaoId")]
    icao_id: Option<String>,
    #[serde(rename = "rawTAF")]
    raw_taf: Option<String>,
    #[serde(rename = "issueTime")]
    issue_time: Option<serde_json::Value>,
    #[serde(rename = "validTimeFrom")]
    valid_time_from: Option<serde_json::Value>,
    #[serde(rename = "validTimeTo")]
    valid_time_to: Option<serde_json::Value>,
    lat: Option<f64>,
    lon: Option<f64>,
}

// AWC international SIGMET JSON response shape
#[derive(Deserialize)]
struct IsigmetEntry {
    #[serde(rename = "icaoId")]
    icao_id: Option<String>,
    #[serde(rename = "firId")]
    fir_id: Option<String>,
    #[serde(rename = "firName")]
    fir_name: Option<String>,
    #[serde(rename = "rawSigmet")]
    raw_sigmet: Option<String>,
    hazard: Option<String>,
    qualifier: Option<String>,
    #[serde(rename = "validTimeFrom")]
    valid_time_from: Option<serde_json::Value>,
    #[serde(rename = "validTimeTo")]
    valid_time_to: Option<serde_json::Value>,
    #[serde(rename = "receiptTime")]
    receipt_time: Option<serde_json::Value>,
}

fn parse_unix_ts(v: &serde_json::Value) -> Option<DateTime<Utc>> {
    match v {
        serde_json::Value::Number(n) => {
            let secs = n.as_i64()?;
            DateTime::from_timestamp(secs, 0)
        }
        serde_json::Value::String(s) => {
            // Try RFC3339 first, then numeric string
            DateTime::parse_from_rfc3339(s)
                .map(|dt| dt.with_timezone(&Utc))
                .ok()
                .or_else(|| {
                    s.parse::<i64>()
                        .ok()
                        .and_then(|secs| DateTime::from_timestamp(secs, 0))
                })
        }
        _ => None,
    }
}

pub async fn fetch_tafs(client: &reqwest::Client, pool: &PgPool) -> Result<usize, String> {
    let url = "https://aviationweather.gov/api/data/taf?format=json&bbox=25,-130,50,-60";

    let body = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("TAF HTTP fetch failed: {e}"))?
        .text()
        .await
        .map_err(|e| format!("TAF body read failed: {e}"))?;

    let entries: Vec<TafEntry> =
        serde_json::from_str(&body).map_err(|e| format!("TAF JSON parse failed: {e}"))?;

    if entries.is_empty() {
        return Ok(0);
    }

    let mut tx = pool.begin().await.map_err(|e| format!("Begin tx: {e}"))?;
    let mut count = 0usize;

    for entry in &entries {
        let raw_text = match &entry.raw_taf {
            Some(t) if !t.trim().is_empty() => t.clone(),
            _ => continue,
        };
        let station = entry.icao_id.clone();
        let issue_time = entry.issue_time.as_ref().and_then(parse_unix_ts);
        let valid_from = entry.valid_time_from.as_ref().and_then(parse_unix_ts);
        let valid_to = entry.valid_time_to.as_ref().and_then(parse_unix_ts);

        let result = sqlx::query(
            "INSERT INTO opmet_text_reports
                (report_type, station, issue_time, valid_from, valid_to, raw_text, latitude, longitude)
             VALUES ('TAF', $1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT DO NOTHING",
        )
        .bind(&station)
        .bind(issue_time)
        .bind(valid_from)
        .bind(valid_to)
        .bind(&raw_text)
        .bind(entry.lat)
        .bind(entry.lon)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Insert TAF: {e}"))?;

        count += result.rows_affected() as usize;
    }

    tx.commit().await.map_err(|e| format!("Commit TAFs: {e}"))?;
    Ok(count)
}

pub async fn fetch_sigmets(client: &reqwest::Client, pool: &PgPool) -> Result<usize, String> {
    let url = "https://aviationweather.gov/api/data/isigmet?format=json";

    let body = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("SIGMET HTTP fetch failed: {e}"))?
        .text()
        .await
        .map_err(|e| format!("SIGMET body read failed: {e}"))?;

    let entries: Vec<IsigmetEntry> =
        serde_json::from_str(&body).map_err(|e| format!("SIGMET JSON parse failed: {e}"))?;

    if entries.is_empty() {
        return Ok(0);
    }

    let mut tx = pool.begin().await.map_err(|e| format!("Begin tx: {e}"))?;
    let mut count = 0usize;

    for entry in &entries {
        let raw_text = match &entry.raw_sigmet {
            Some(t) if !t.trim().is_empty() => t.clone(),
            _ => continue,
        };
        // Use firId as station identifier, fall back to icaoId
        let station = entry.fir_id.clone().or_else(|| entry.icao_id.clone());
        let issue_time = entry.receipt_time.as_ref().and_then(parse_unix_ts);
        let valid_from = entry.valid_time_from.as_ref().and_then(parse_unix_ts);
        let valid_to = entry.valid_time_to.as_ref().and_then(parse_unix_ts);

        let result = sqlx::query(
            "INSERT INTO opmet_text_reports
                (report_type, station, fir_name, issue_time, valid_from, valid_to,
                 raw_text, hazard, qualifier)
             VALUES ('SIGMET', $1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT DO NOTHING",
        )
        .bind(&station)
        .bind(&entry.fir_name)
        .bind(issue_time)
        .bind(valid_from)
        .bind(valid_to)
        .bind(&raw_text)
        .bind(&entry.hazard)
        .bind(&entry.qualifier)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Insert SIGMET: {e}"))?;

        count += result.rows_affected() as usize;
    }

    tx.commit()
        .await
        .map_err(|e| format!("Commit SIGMETs: {e}"))?;
    Ok(count)
}
