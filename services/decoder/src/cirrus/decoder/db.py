"""Database operations for the decoder service."""

import logging

import psycopg

logger = logging.getLogger(__name__)


def get_download_info(conn: psycopg.Connection, download_id: int) -> dict | None:
    """Look up a grib_downloads row by ID. Returns dict with run_time and forecast_hour."""
    row = conn.execute(
        "SELECT run_time, forecast_hour FROM grib_downloads WHERE id = %s",
        (download_id,),
    ).fetchone()
    if row is None:
        return None
    return {"run_time": row[0], "forecast_hour": row[1]}


def insert_fields(conn: psycopg.Connection, fields: list[dict]) -> int:
    """Insert decoded fields into gridded_fields table.

    Uses ON CONFLICT DO UPDATE for idempotent re-processing.
    Returns the number of fields processed.
    """
    if not fields:
        return 0

    sql = """
        INSERT INTO gridded_fields (
            download_id, run_time, forecast_hour, valid_time,
            parameter, level_hpa, level_type,
            ni, nj, lat_first, lon_first, lat_last, lon_last, d_lat, d_lon,
            values
        ) VALUES (
            %(download_id)s, %(run_time)s, %(forecast_hour)s, %(valid_time)s,
            %(parameter)s, %(level_hpa)s, %(level_type)s,
            %(ni)s, %(nj)s, %(lat_first)s, %(lon_first)s, %(lat_last)s, %(lon_last)s,
            %(d_lat)s, %(d_lon)s, %(values)s
        )
        ON CONFLICT (run_time, forecast_hour, parameter, level_hpa, level_type)
        DO UPDATE SET
            download_id = EXCLUDED.download_id,
            valid_time = EXCLUDED.valid_time,
            ni = EXCLUDED.ni, nj = EXCLUDED.nj,
            lat_first = EXCLUDED.lat_first, lon_first = EXCLUDED.lon_first,
            lat_last = EXCLUDED.lat_last, lon_last = EXCLUDED.lon_last,
            d_lat = EXCLUDED.d_lat, d_lon = EXCLUDED.d_lon,
            values = EXCLUDED.values,
            ingested_at = NOW()
    """

    with conn.transaction():
        cur = conn.cursor()
        cur.executemany(sql, fields)
    return len(fields)


def mark_decoded(conn: psycopg.Connection, download_id: int) -> None:
    """Mark a download as decoded and notify listeners."""
    with conn.transaction():
        conn.execute(
            "UPDATE grib_downloads SET decoded = TRUE WHERE id = %s",
            (download_id,),
        )
        conn.execute("NOTIFY gridded_data_updated")
