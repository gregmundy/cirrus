"""Tests for max wind (surface type 6) decoding in grib_decoder."""
from unittest.mock import patch, MagicMock
from datetime import datetime, timezone

from cirrus.decoder.grib_decoder import _extract_field, MAX_WIND_SURFACE_TYPE


def test_max_wind_surface_type_constant():
    assert MAX_WIND_SURFACE_TYPE == 6


def test_extract_field_maxwind_level():
    """Max wind surface type 6 should produce level_type='maxwind', level_hpa=-1."""
    msgid = MagicMock()

    def mock_get(mid, key):
        vals = {
            "shortName": "u",
            "typeOfFirstFixedSurface": 6,
            "level": 250,
            "Ni": 4,
            "Nj": 2,
            "latitudeOfFirstGridPointInDegrees": 90.0,
            "longitudeOfFirstGridPointInDegrees": 0.0,
            "latitudeOfLastGridPointInDegrees": -90.0,
            "longitudeOfLastGridPointInDegrees": 359.75,
            "jDirectionIncrementInDegrees": 0.25,
            "iDirectionIncrementInDegrees": 0.25,
        }
        return vals[key]

    import numpy as np
    def mock_get_array(mid, key):
        return np.zeros(8, dtype=np.float32)

    with patch("eccodes.codes_get", side_effect=mock_get), \
         patch("eccodes.codes_get_array", side_effect=mock_get_array):
        result = _extract_field(msgid, 1, datetime(2026, 3, 22, tzinfo=timezone.utc), 6)

    assert result is not None
    assert result["level_type"] == "maxwind"
    assert result["level_hpa"] == -1
    assert result["parameter"] == "UGRD"


def test_extract_field_tropopause_unchanged():
    """Tropopause (type 7) still works after adding max wind."""
    msgid = MagicMock()

    def mock_get(mid, key):
        vals = {
            "shortName": "t",
            "typeOfFirstFixedSurface": 7,
            "level": 200,
            "Ni": 4,
            "Nj": 2,
            "latitudeOfFirstGridPointInDegrees": 90.0,
            "longitudeOfFirstGridPointInDegrees": 0.0,
            "latitudeOfLastGridPointInDegrees": -90.0,
            "longitudeOfLastGridPointInDegrees": 359.75,
            "jDirectionIncrementInDegrees": 0.25,
            "iDirectionIncrementInDegrees": 0.25,
        }
        return vals[key]

    import numpy as np
    def mock_get_array(mid, key):
        return np.zeros(8, dtype=np.float32)

    with patch("eccodes.codes_get", side_effect=mock_get), \
         patch("eccodes.codes_get_array", side_effect=mock_get_array):
        result = _extract_field(msgid, 1, datetime(2026, 3, 22, tzinfo=timezone.utc), 6)

    assert result is not None
    assert result["level_type"] == "tropopause"
    assert result["level_hpa"] == -1
    assert result["parameter"] == "TMP"
