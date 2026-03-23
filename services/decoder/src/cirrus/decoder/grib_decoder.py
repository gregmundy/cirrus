"""GRIB2 decoding using ecCodes — extracts gridded fields from GRIB2 files."""

import logging
from datetime import datetime, timedelta, timezone

import eccodes
import numpy as np

logger = logging.getLogger(__name__)

PARAM_MAP = {
    "u": "UGRD",
    "v": "VGRD",
    "t": "TMP",
    "gh": "HGT",
    "r": "RH",
    "pres": "PRES",
    "trpp": "PRES",  # Tropopause pressure (GFS shortName)
}

# ecCodes returns typeOfFirstFixedSurface as a string
TROPOPAUSE_SURFACE_TYPE = 7
MAX_WIND_SURFACE_TYPE = 6


def decode_file(filepath: str, download_id: int, run_time: datetime, forecast_hour: int) -> list[dict]:
    """Decode all GRIB2 messages in a file and return a list of field dicts."""
    fields = []
    with open(filepath, "rb") as f:
        while True:
            msgid = eccodes.codes_grib_new_from_file(f)
            if msgid is None:
                break
            try:
                field = _extract_field(msgid, download_id, run_time, forecast_hour)
                if field is not None:
                    fields.append(field)
            except Exception:
                logger.exception("Failed to decode GRIB2 message in %s, skipping", filepath)
            finally:
                eccodes.codes_release(msgid)

    logger.info("Decoded %d fields from %s", len(fields), filepath)
    return fields


def _extract_field(msgid: int, download_id: int, run_time: datetime, forecast_hour: int) -> dict | None:
    """Extract a single gridded field from a GRIB2 message."""
    short_name = eccodes.codes_get(msgid, "shortName")

    parameter = PARAM_MAP.get(short_name)
    if parameter is None:
        return None

    # Tropopause pressure is identified by shortName "trpp" in GFS,
    # not by surface type 7 as in the GRIB2 spec
    if short_name == "trpp":
        level_hpa = -1
        level_type = "tropopause"
    else:
        # ecCodes may return typeOfFirstFixedSurface as int or string
        raw_surface_type = eccodes.codes_get(msgid, "typeOfFirstFixedSurface")
        try:
            surface_type = int(raw_surface_type)
        except (ValueError, TypeError):
            surface_type = -1  # Non-numeric surface type (e.g., "pl", "sfc")

        if surface_type == TROPOPAUSE_SURFACE_TYPE:
            level_hpa = -1
            level_type = "tropopause"
        elif surface_type == MAX_WIND_SURFACE_TYPE:
            level_hpa = -1
            level_type = "maxwind"
        else:
            level_hpa = eccodes.codes_get(msgid, "level")
            level_type = "isobaricInhPa"

    ni = eccodes.codes_get(msgid, "Ni")
    nj = eccodes.codes_get(msgid, "Nj")
    values = eccodes.codes_get_array(msgid, "values").astype(np.float32)

    valid_time = run_time + timedelta(hours=forecast_hour)

    return {
        "download_id": download_id,
        "run_time": run_time,
        "forecast_hour": forecast_hour,
        "valid_time": valid_time,
        "parameter": parameter,
        "level_hpa": level_hpa,
        "level_type": level_type,
        "ni": ni,
        "nj": nj,
        "lat_first": eccodes.codes_get(msgid, "latitudeOfFirstGridPointInDegrees"),
        "lon_first": eccodes.codes_get(msgid, "longitudeOfFirstGridPointInDegrees"),
        "lat_last": eccodes.codes_get(msgid, "latitudeOfLastGridPointInDegrees"),
        "lon_last": eccodes.codes_get(msgid, "longitudeOfLastGridPointInDegrees"),
        "d_lat": eccodes.codes_get(msgid, "jDirectionIncrementInDegrees"),
        "d_lon": eccodes.codes_get(msgid, "iDirectionIncrementInDegrees"),
        "values": values.tobytes(),
    }
