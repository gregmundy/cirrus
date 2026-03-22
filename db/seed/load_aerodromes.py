"""Download OurAirports data and seed the aerodromes table."""

import csv
import io
import logging
import os
import sys
import urllib.request

import psycopg

AIRPORTS_URL = "https://davidmegginson.github.io/ourairports-data/airports.csv"

logger = logging.getLogger(__name__)


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL environment variable required", file=sys.stderr)
        sys.exit(1)

    logger.info("Downloading airports from OurAirports...")
    with urllib.request.urlopen(AIRPORTS_URL) as resp:
        raw = resp.read().decode("utf-8")

    reader = csv.DictReader(io.StringIO(raw))
    airports = []
    for row in reader:
        icao = (row.get("icao_code") or "").strip()
        if not icao or len(icao) != 4:
            continue
        if row.get("type") == "closed":
            continue
        try:
            lat = float(row["latitude_deg"])
            lon = float(row["longitude_deg"])
        except (ValueError, KeyError):
            continue
        elevation = None
        try:
            elevation = int(float(row.get("elevation_ft", "")))
        except (ValueError, TypeError):
            pass
        airports.append({
            "icao_code": icao,
            "name": row.get("name", ""),
            "latitude": lat,
            "longitude": lon,
            "elevation_ft": elevation,
            "country": row.get("iso_country", ""),
            "continent": row.get("continent", ""),
            "municipality": row.get("municipality", ""),
        })

    logger.info("Parsed %d airports with ICAO codes", len(airports))

    conn = psycopg.connect(database_url)

    sql = """
        INSERT INTO aerodromes (icao_code, name, latitude, longitude, elevation_ft, country, continent, municipality)
        VALUES (%(icao_code)s, %(name)s, %(latitude)s, %(longitude)s, %(elevation_ft)s, %(country)s, %(continent)s, %(municipality)s)
        ON CONFLICT (icao_code) DO UPDATE SET
            name = EXCLUDED.name,
            latitude = EXCLUDED.latitude,
            longitude = EXCLUDED.longitude,
            elevation_ft = EXCLUDED.elevation_ft,
            country = EXCLUDED.country,
            continent = EXCLUDED.continent,
            municipality = EXCLUDED.municipality
    """

    with conn.transaction():
        cur = conn.cursor()
        cur.executemany(sql, airports)

    logger.info("Loaded %d aerodromes into database", len(airports))
    conn.close()


if __name__ == "__main__":
    main()
