use chrono::{DateTime, Duration, NaiveTime, Utc};

/// GFS run hours (UTC)
const RUN_HOURS: [u32; 4] = [18, 12, 6, 0];

/// How long after the nominal run time before data is typically available
const AVAILABILITY_OFFSET_MINUTES: i64 = 270; // 4h30m

/// All forecast hours we download per cycle (f006 through f036, step 3)
pub const FORECAST_HOURS: [u32; 11] = [6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36];

/// Determine the latest GFS cycle that should be available for download.
pub fn latest_available_cycle(now: DateTime<Utc>) -> Option<DateTime<Utc>> {
    let today = now.date_naive();
    let yesterday = today - Duration::days(1);

    // Check today's runs from latest to earliest, then yesterday's
    for &day in &[today, yesterday] {
        for &run_hour in &RUN_HOURS {
            let nominal_time = NaiveTime::from_hms_opt(run_hour, 0, 0).unwrap();
            let nominal = day.and_time(nominal_time).and_utc();
            let available_at = nominal + Duration::minutes(AVAILABILITY_OFFSET_MINUTES);
            if now >= available_at {
                return Some(nominal);
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn test_latest_cycle_after_00z_available() {
        let now = Utc.with_ymd_and_hms(2026, 3, 21, 5, 0, 0).unwrap();
        let cycle = latest_available_cycle(now).unwrap();
        assert_eq!(cycle, Utc.with_ymd_and_hms(2026, 3, 21, 0, 0, 0).unwrap());
    }

    #[test]
    fn test_latest_cycle_before_00z_available() {
        let now = Utc.with_ymd_and_hms(2026, 3, 21, 4, 0, 0).unwrap();
        let cycle = latest_available_cycle(now).unwrap();
        assert_eq!(cycle, Utc.with_ymd_and_hms(2026, 3, 20, 18, 0, 0).unwrap());
    }

    #[test]
    fn test_latest_cycle_afternoon() {
        let now = Utc.with_ymd_and_hms(2026, 3, 21, 17, 0, 0).unwrap();
        let cycle = latest_available_cycle(now).unwrap();
        assert_eq!(cycle, Utc.with_ymd_and_hms(2026, 3, 21, 12, 0, 0).unwrap());
    }

    #[test]
    fn test_latest_cycle_just_before_12z_available() {
        let now = Utc.with_ymd_and_hms(2026, 3, 21, 16, 29, 0).unwrap();
        let cycle = latest_available_cycle(now).unwrap();
        assert_eq!(cycle, Utc.with_ymd_and_hms(2026, 3, 21, 6, 0, 0).unwrap());
    }
}
