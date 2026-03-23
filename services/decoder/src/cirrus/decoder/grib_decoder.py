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
}

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

    level_type_int = eccodes.codes_get(msgid, "typeOfFirstFixedSurface")

    if level_type_int == TROPOPAUSE_SURFACE_TYPE:
        level_hpa = -1
        level_type = "tropopause"
    elif level_type_int == MAX_WIND_SURFACE_TYPE:
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
