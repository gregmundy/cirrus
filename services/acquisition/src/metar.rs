use chrono::{DateTime, NaiveDateTime, Utc};
use sqlx::PgPool;

struct MetarRow {
    station: String,
    observation_time: DateTime<Utc>,
    raw_text: String,
    latitude: f64,
    longitude: f64,
    flight_category: Option<String>,
    wind_dir: Option<i32>,
    wind_speed: Option<i32>,
    wind_gust: Option<i32>,
    visibility_sm: Option<f32>,
    wx_string: Option<String>,
    sky_cover: Option<String>,
    ceiling_ft: Option<i32>,
    temp_c: Option<f32>,
    dewpoint_c: Option<f32>,
    altimeter: Option<f32>,
    slp_hpa: Option<f32>,
}

pub async fn fetch_and_store(
    client: &reqwest::Client,
    pool: &PgPool,
    cache_url: &str,
) -> Result<usize, String> {
    let body = client
        .get(cache_url)
        .send()
        .await
        .map_err(|e| format!("HTTP fetch failed: {e}"))?
        .text()
        .await
        .map_err(|e| format!("Body read failed: {e}"))?;

    let mut rows = Vec::new();
    let mut rdr = csv::ReaderBuilder::new()
        .comment(Some(b'!'))
        .flexible(true)
        .from_reader(body.as_bytes());

    for result in rdr.records() {
        let record = match result {
            Ok(r) => r,
            Err(_) => continue,
        };
        if let Some(row) = parse_csv_record(&record) {
            rows.push(row);
        }
    }

    if rows.is_empty() {
        return Ok(0);
    }

    let count = insert_metars(pool, &rows).await?;
    Ok(count)
}

fn parse_csv_record(record: &csv::StringRecord) -> Option<MetarRow> {
    let raw_text = record.get(0)?.trim().to_string();
    let station = record.get(1)?.trim().to_string();
    if station.len() != 4 {
        return None;
    }

    let obs_str = record.get(2)?.trim();
    let observation_time = parse_datetime(obs_str)?;
    let latitude = record.get(3)?.trim().parse::<f64>().ok()?;
    let longitude = record.get(4)?.trim().parse::<f64>().ok()?;

    let temp_c = record.get(5).and_then(|s| s.trim().parse().ok());
    let dewpoint_c = record.get(6).and_then(|s| s.trim().parse().ok());
    let wind_dir = record.get(7).and_then(|s| s.trim().parse().ok());
    let wind_speed = record.get(8).and_then(|s| s.trim().parse().ok());
    let wind_gust = record.get(9).and_then(|s| s.trim().parse().ok());
    let visibility_sm = record.get(10).and_then(|s| s.trim().parse().ok());
    let altimeter = record.get(11).and_then(|s| s.trim().parse().ok());
    let slp_hpa: Option<f32> = record.get(12).and_then(|s| s.trim().parse().ok());
    let wx_string = record.get(21).map(|s| s.trim().to_string()).filter(|s| !s.is_empty());

    let mut ceiling_ft: Option<i32> = None;
    let mut lowest_cover: Option<String> = None;
    for layer_idx in (22..=28).step_by(2) {
        let cover = record.get(layer_idx).map(|s| s.trim()).unwrap_or("");
        let base = record.get(layer_idx + 1).and_then(|s| s.trim().parse::<i32>().ok());
        if (cover == "BKN" || cover == "OVC" || cover == "VV") && base.is_some() {
            if ceiling_ft.is_none() || base.unwrap() < ceiling_ft.unwrap() {
                ceiling_ft = base;
                lowest_cover = Some(cover.to_string());
            }
        }
        if lowest_cover.is_none() && !cover.is_empty() {
            lowest_cover = Some(cover.to_string());
        }
    }

    let flight_category = record.get(30).map(|s| s.trim().to_string()).filter(|s| !s.is_empty());

    Some(MetarRow {
        station, observation_time, raw_text, latitude, longitude,
        flight_category, wind_dir, wind_speed, wind_gust,
        visibility_sm, wx_string, sky_cover: lowest_cover, ceiling_ft,
        temp_c, dewpoint_c, altimeter, slp_hpa,
    })
}

fn parse_datetime(s: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s)
        .map(|dt| dt.with_timezone(&Utc))
        .ok()
        .or_else(|| {
            NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%SZ")
                .ok()
                .map(|ndt| ndt.and_utc())
        })
}

async fn insert_metars(pool: &PgPool, rows: &[MetarRow]) -> Result<usize, String> {
    let known_stations: std::collections::HashSet<String> =
        sqlx::query_scalar("SELECT icao_code::TEXT FROM aerodromes")
            .fetch_all(pool)
            .await
            .map_err(|e| format!("Fetch aerodromes: {e}"))?
            .into_iter()
            .collect();

    let mut tx = pool.begin().await.map_err(|e| format!("Begin tx: {e}"))?;

    let mut count = 0usize;
    for row in rows {
        if !known_stations.contains(&row.station) {
            continue;
        }

        let result = sqlx::query(
            "INSERT INTO opmet_reports (
                observation_time, station, report_type, raw_text,
                flight_category, wind_dir_degrees, wind_speed_kt, wind_gust_kt,
                visibility_sm, wx_string, sky_cover, ceiling_ft,
                temp_c, dewpoint_c, altimeter_inhg, slp_hpa, latitude, longitude
            ) VALUES ($1, $2, 'METAR', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
            ON CONFLICT (station, observation_time, report_type) DO NOTHING"
        )
        .bind(row.observation_time)
        .bind(&row.station)
        .bind(&row.raw_text)
        .bind(&row.flight_category)
        .bind(row.wind_dir)
        .bind(row.wind_speed)
        .bind(row.wind_gust)
        .bind(row.visibility_sm)
        .bind(&row.wx_string)
        .bind(&row.sky_cover)
        .bind(row.ceiling_ft)
        .bind(row.temp_c)
        .bind(row.dewpoint_c)
        .bind(row.altimeter)
        .bind(row.slp_hpa)
        .bind(row.latitude)
        .bind(row.longitude)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Insert METAR: {e}"))?;

        count += result.rows_affected() as usize;
    }

    tx.commit().await.map_err(|e| format!("Commit: {e}"))?;
    Ok(count)
}
