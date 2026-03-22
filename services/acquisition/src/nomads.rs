use chrono::{DateTime, Utc};
use std::path::{Path, PathBuf};
use tokio::fs;
use tracing;

/// NOMADS filter parameters for WAFS-relevant GFS variables
const PARAMS: &[&str] = &[
    "var_UGRD=on", "var_VGRD=on", "var_TMP=on",
    "var_HGT=on", "var_RH=on", "var_PRES=on",
];

/// GFS pressure levels approximating WAFS flight levels (see spec Section 2.4)
const LEVELS: &[&str] = &[
    "lev_70_mb=on", "lev_100_mb=on", "lev_150_mb=on", "lev_200_mb=on",
    "lev_250_mb=on", "lev_300_mb=on", "lev_400_mb=on", "lev_500_mb=on",
    "lev_600_mb=on", "lev_700_mb=on", "lev_850_mb=on",
    "lev_tropopause=on",
];

/// Build the NOMADS filter URL for a specific GFS cycle and forecast hour.
pub fn build_url(base_url: &str, run_time: DateTime<Utc>, forecast_hour: u32) -> String {
    let date = run_time.format("%Y%m%d").to_string();
    let hour = run_time.format("%H").to_string();
    let fhour = format!("{:03}", forecast_hour);

    let params_str = PARAMS.join("&");
    let levels_str = LEVELS.join("&");

    format!(
        "{base_url}?dir=%2Fgfs.{date}%2F{hour}%2Fatmos\
         &file=gfs.t{hour}z.pgrb2.0p25.f{fhour}\
         &{params_str}&{levels_str}"
    )
}

/// Build the local file path for a downloaded GRIB2 file.
pub fn file_path(store_path: &str, run_time: DateTime<Utc>, forecast_hour: u32) -> PathBuf {
    let date = run_time.format("%Y%m%d").to_string();
    let hour = run_time.format("%H").to_string();
    Path::new(store_path)
        .join(&date)
        .join(&hour)
        .join(format!("gfs_f{:03}.grib2", forecast_hour))
}

/// Download a single GRIB2 file from NOMADS with retries.
///
/// Returns the file size in bytes on success.
pub async fn download(
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
) -> Result<u64, String> {
    // Ensure parent directory exists
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).await
            .map_err(|e| format!("Failed to create directory {}: {}", parent.display(), e))?;
    }

    const BACKOFF_SECS: [u64; 3] = [1, 2, 4];
    let mut last_err = String::new();
    for attempt in 0..3 {
        if attempt > 0 {
            let delay = std::time::Duration::from_secs(BACKOFF_SECS[attempt]);
            tracing::info!("Retry {}/{} for {} after {delay:?}", attempt, 3, url);
            tokio::time::sleep(delay).await;
        }

        match client.get(url).send().await {
            Ok(resp) => {
                if !resp.status().is_success() {
                    last_err = format!("HTTP {} from {}", resp.status(), url);
                    tracing::warn!("{last_err}");
                    continue;
                }
                match resp.bytes().await {
                    Ok(bytes) => {
                        if bytes.is_empty() {
                            last_err = format!("Empty response from {}", url);
                            tracing::warn!("{last_err}");
                            continue;
                        }
                        fs::write(dest, &bytes).await
                            .map_err(|e| format!("Failed to write {}: {}", dest.display(), e))?;
                        return Ok(bytes.len() as u64);
                    }
                    Err(e) => {
                        last_err = format!("Failed to read response body from {}: {}", url, e);
                        tracing::warn!("{last_err}");
                        continue;
                    }
                }
            }
            Err(e) => {
                last_err = format!("HTTP request failed for {}: {}", url, e);
                tracing::warn!("{last_err}");
                continue;
            }
        }
    }

    Err(format!("All 3 attempts failed for {url}: {last_err}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn test_build_url() {
        let run_time = Utc.with_ymd_and_hms(2026, 3, 21, 12, 0, 0).unwrap();
        let url = build_url(
            "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl",
            run_time,
            6,
        );
        assert!(url.contains("dir=%2Fgfs.20260321%2F12%2Fatmos"));
        assert!(url.contains("file=gfs.t12z.pgrb2.0p25.f006"));
        assert!(url.contains("var_UGRD=on"));
        assert!(url.contains("lev_850_mb=on"));
        assert!(url.contains("lev_tropopause=on"));
        assert!(url.contains("var_PRES=on"));
    }

    #[test]
    fn test_file_path() {
        let run_time = Utc.with_ymd_and_hms(2026, 3, 21, 0, 0, 0).unwrap();
        let path = file_path("/data/grib", run_time, 12);
        assert_eq!(path, PathBuf::from("/data/grib/20260321/00/gfs_f012.grib2"));
    }
}
