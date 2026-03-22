use std::env;

pub struct Config {
    pub database_url: String,
    pub nomads_base_url: String,
    pub poll_interval_secs: u64,
    pub retention_hours: i64,
    pub grib_store_path: String,
}

impl Config {
    pub fn from_env() -> Self {
        Self {
            database_url: env::var("DATABASE_URL").expect("DATABASE_URL must be set"),
            nomads_base_url: env::var("NOMADS_BASE_URL")
                .unwrap_or_else(|_| "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl".into()),
            poll_interval_secs: env::var("POLL_INTERVAL_SECS")
                .unwrap_or_else(|_| "300".into())
                .parse()
                .expect("POLL_INTERVAL_SECS must be a number"),
            retention_hours: env::var("RETENTION_HOURS")
                .unwrap_or_else(|_| "48".into())
                .parse()
                .expect("RETENTION_HOURS must be a number"),
            grib_store_path: env::var("GRIB_STORE_PATH")
                .unwrap_or_else(|_| "/data/grib".into()),
        }
    }
}
