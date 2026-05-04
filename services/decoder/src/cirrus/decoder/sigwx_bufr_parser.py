"""SIGWX BUFR parser — extracts meteorological features from WAFS SIGWX BUFR messages.

Decodes BUFR edition 3 messages (WMO data category 7) from WAFS centres
into the same SigwxFeature/SigwxMetadata structures as the IWXXM XML parser,
so features plug directly into the existing rendering pipeline.

BUFR SIGWX structure (per file, typically 10-12 messages):
  - Each message contains one phenomenon type (cloud, turbulence, jets, etc.)
  - Messages share header times (issue time + valid time)
  - Feature geometry is encoded as replicated lat/lon sequences
  - Two forecast periods per file (e.g. T+24 and T+36)

Reference: WMO Manual on Codes, FM 94 BUFR, Table C-1 for SIGWX descriptors.
"""

import logging
from datetime import datetime, timezone

import eccodes

from cirrus.decoder.sigwx_parser import SigwxFeature, SigwxMetadata

logger = logging.getLogger(__name__)

# BUFR meteorologicalFeature code table (0-20-008)
_MET_FEATURE = {
    10: "JETSTREAM",
    12: "CLOUD",
    13: "TURBULENCE",
    17: "VOLCANO",  # also used for point features in general
}

# BUFR synopticFeatureType code table
_SYNOPTIC_TYPE = {
    2: "TROPICAL_CYCLONE",
}

# Cloud distribution codes (0-20-012)
_CLOUD_DIST = {
    10: "OCNL",   # occasional (ISOL CB / OCNL CB)
    11: "FRQ",    # frequent
    12: "OBSC",   # obscured
    13: "EMBD",   # embedded
}

# Cloud type codes (0-20-012 sub)
_CLOUD_TYPE = {
    9: "CB",
    6: "TCU",
}

# Extended degree of turbulence (0-11-030)
_TURB_DEGREE = {
    2: "LIGHT",
    4: "MODERATE",
    6: "MODERATE",
    7: "MODERATE",
    8: "SEVERE",
    10: "SEVERE",
}

# Originating centres
_CENTRES = {
    7: "Washington",
    74: "London",
}

MISSING_INT = 2147483647
MISSING_FLOAT = -1e100

# Chart level classification based on message-level height bounds
# SWH: FL250–FL630 (7620m–19200m) — upper-level SIGWX
# SWM: FL100–FL450 (3050m–13720m) — medium-level SIGWX
CHART_LEVELS = {
    (7620, 19200): "SWH",
    (3050, 13720): "SWM",
    (3050, 19200): "SWH",  # point features spanning full range → tag as SWH
}


def _is_missing(v) -> bool:
    """Check if a BUFR value is missing."""
    if isinstance(v, int):
        return v == MISSING_INT
    if isinstance(v, float):
        return v == MISSING_FLOAT or v < -1e99
    return False


def _m_to_fl(metres: float) -> int:
    """Convert metres to flight level."""
    return round(metres * 3.28084 / 100)


def _get(bufr, key, default=None):
    """Safe get from BUFR handle."""
    try:
        v = eccodes.codes_get(bufr, key)
        if _is_missing(v):
            return default
        return v
    except Exception:
        return default


def _classify_chart_level(lower_m: float, upper_m: float) -> str:
    """Classify chart level from message-level height bounds.

    Returns "SWH", "SWM", or a descriptive fallback like "FL100-FL630".
    """
    key = (round(lower_m), round(upper_m))
    if key in CHART_LEVELS:
        return CHART_LEVELS[key]
    # Fallback: classify by lower bound
    lower_fl = _m_to_fl(lower_m)
    if lower_fl >= 250:
        return "SWH"
    elif lower_fl >= 100:
        return "SWM"
    return f"FL{lower_fl}-FL{_m_to_fl(upper_m)}"


def parse_sigwx_bufr(bufr_bytes: bytes) -> tuple[SigwxMetadata, list[SigwxFeature]]:
    """Parse a SIGWX BUFR file containing multiple messages.

    Args:
        bufr_bytes: Raw BUFR file content.

    Returns:
        Tuple of (metadata, list of features).
    """
    features: list[SigwxFeature] = []
    metadata = SigwxMetadata()

    # eccodes needs a file-like object; write to temp and read back
    import tempfile
    with tempfile.NamedTemporaryFile(suffix=".bufr", delete=True) as tmp:
        tmp.write(bufr_bytes)
        tmp.flush()

        with open(tmp.name, "rb") as f:
            msg_count = eccodes.codes_count_in_file(f)
            f.seek(0)

            for msg_idx in range(msg_count):
                bufr = eccodes.codes_bufr_new_from_file(f)
                if bufr is None:
                    continue

                try:
                    # Extract header before unpack
                    if not metadata.originating_centre:
                        centre_code = _get(bufr, "bufrHeaderCentre", 0)
                        metadata.originating_centre = _CENTRES.get(centre_code, str(centre_code))

                    eccodes.codes_set(bufr, "unpack", 1)
                except Exception:
                    logger.debug("Failed to unpack BUFR message %d, skipping", msg_idx + 1)
                    eccodes.codes_release(bufr)
                    continue

                try:
                    # Extract times from first message
                    if not metadata.phenomenon_time:
                        _extract_times(bufr, metadata)

                    # Determine chart level from message-level height bounds
                    h1 = _get(bufr, "#1#height")
                    h2 = _get(bufr, "#2#height")
                    chart_level = None
                    if h1 is not None and h2 is not None:
                        chart_level = _classify_chart_level(h1, h2)

                    # Parse features from this message
                    msg_features = _parse_message(bufr, msg_idx, chart_level)
                    features.extend(msg_features)
                except Exception:
                    logger.exception("Failed to parse BUFR message %d", msg_idx + 1)
                finally:
                    eccodes.codes_release(bufr)

    logger.info(
        "Parsed SIGWX BUFR: %s, %s, %d features across %d messages",
        metadata.originating_centre,
        metadata.phenomenon_time,
        len(features),
        msg_count,
    )
    return metadata, features


def _extract_times(bufr, metadata: SigwxMetadata) -> None:
    """Extract issue time and valid time from BUFR header."""
    # timeSignificance=16 is analysis/issue time, =4 is forecast valid time
    for i in [1, 2]:
        ts = _get(bufr, f"#{i}#timeSignificance")
        y = _get(bufr, f"#{i}#year")
        m = _get(bufr, f"#{i}#month")
        d = _get(bufr, f"#{i}#day")
        h = _get(bufr, f"#{i}#hour")
        mn = _get(bufr, f"#{i}#minute", 0)
        if y and m and d and h is not None:
            dt = datetime(y, m, d, h, mn, tzinfo=timezone.utc)
            iso = dt.isoformat()
            if ts == 16:
                metadata.issue_time = iso
                metadata.phenomenon_base_time = iso
            elif ts == 4:
                metadata.phenomenon_time = iso


def _parse_message(bufr, msg_idx: int, chart_level: str | None = None) -> list[SigwxFeature]:
    """Parse all features from a single BUFR message."""
    # Walk all keys to build an ordered list of (key, index, value) triples
    it = eccodes.codes_keys_iterator_new(bufr)
    keys_seen: dict[str, int] = {}
    entries: list[tuple[str, int, object]] = []

    while eccodes.codes_keys_iterator_next(it):
        k = eccodes.codes_keys_iterator_get_name(it)
        keys_seen[k] = keys_seen.get(k, 0) + 1
        idx = keys_seen[k]
        try:
            v = eccodes.codes_get(bufr, f"#{idx}#{k}")
            entries.append((k, idx, v))
        except Exception:
            pass
    eccodes.codes_keys_iterator_delete(it)

    if not entries:
        return []

    # Detect message type from keys present
    key_set = {e[0] for e in entries}

    if "stormName" in key_set or "featureName" in key_set:
        features = _parse_point_features_msg(entries)
    elif "nonCoordinateHeight" in key_set:
        features = _parse_tropopause_msg(entries)
    elif "extendedDegreeOfTurbulence" in key_set:
        features = _parse_area_features_msg(entries, "TURBULENCE")
    elif "cloudDistributionForAviation" in key_set:
        features = _parse_cloud_msg(entries)
    elif "windSpeed" in key_set and "flightLevel" in key_set:
        features = _parse_jet_msg(entries)
    else:
        # Check for empty messages or unknown types
        n_feat = 0
        for k, _, v in entries:
            if k == "delayedDescriptorReplicationFactor" and not _is_missing(v):
                n_feat = max(n_feat, v)
                break
        if n_feat == 0:
            return []
        logger.debug("Unknown BUFR message type (msg %d), keys: %s", msg_idx + 1, key_set)
        return []

    # Tag every feature with its chart level
    if chart_level:
        for f in features:
            f.properties["chart_level"] = chart_level

    return features


def _parse_cloud_msg(entries: list) -> list[SigwxFeature]:
    """Parse cloud/CB features from a BUFR message."""
    features: list[SigwxFeature] = []

    # Split entries into feature groups at meteorologicalFeature boundaries
    feature_groups = _split_into_features(entries)

    for group in feature_groups:
        lats, lons = [], []
        cloud_dist = None
        cloud_type = None
        heights_raw: list = []  # (value_or_missing, ...)

        for k, _, v in group:
            if k == "latitude" and not _is_missing(v):
                lats.append(v)
            elif k == "longitude" and not _is_missing(v):
                lons.append(v)
            elif k == "cloudDistributionForAviation" and not _is_missing(v):
                cloud_dist = v
            elif k == "cloudType" and not _is_missing(v):
                cloud_type = v
            elif k == "height":
                heights_raw.append(v)

        if len(lats) < 3:
            continue

        coords = [[lon, lat] for lat, lon in zip(lats, lons)]
        # Close polygon if not closed
        if coords and coords[0] != coords[-1]:
            coords.append(coords[0])

        props: dict = {}
        if cloud_dist is not None:
            props["cloud_distribution_code"] = _CLOUD_DIST.get(cloud_dist, str(cloud_dist))
        if cloud_type is not None:
            props["cloud_type_code"] = _CLOUD_TYPE.get(cloud_type, str(cloud_type))

        # Heights come as a pair: [upper_or_missing, lower_or_missing]
        # For CB clouds, typically one is the cloud top and the other is MISSING
        valid_heights = [h for h in heights_raw if not _is_missing(h) and h > 0]
        if len(valid_heights) >= 2:
            props["upper_fl"] = _m_to_fl(max(valid_heights))
            props["lower_fl"] = _m_to_fl(min(valid_heights))
        elif len(valid_heights) == 1:
            # Single height = cloud top (CB top)
            props["upper_fl"] = _m_to_fl(valid_heights[0])

        features.append(SigwxFeature(
            phenomenon="CLOUD",
            geometry_type="Polygon",
            coordinates=[coords],
            properties=props,
        ))

    return features


def _parse_area_features_msg(entries: list, phenomenon: str) -> list[SigwxFeature]:
    """Parse turbulence or icing area features."""
    features: list[SigwxFeature] = []
    feature_groups = _split_into_features(entries)

    for group in feature_groups:
        lats, lons = [], []
        degree = None
        heights_raw: list = []

        for k, _, v in group:
            if k == "latitude" and not _is_missing(v):
                lats.append(v)
            elif k == "longitude" and not _is_missing(v):
                lons.append(v)
            elif k == "extendedDegreeOfTurbulence" and not _is_missing(v):
                degree = v
            elif k == "height":
                heights_raw.append(v)

        if len(lats) < 3:
            continue

        coords = [[lon, lat] for lat, lon in zip(lats, lons)]
        if coords and coords[0] != coords[-1]:
            coords.append(coords[0])

        props: dict = {}
        if degree is not None:
            props["DegreeOfTurbulence_code"] = str(degree)
            props["severity"] = _TURB_DEGREE.get(degree, "UNKNOWN")

        valid_heights = [h for h in heights_raw if not _is_missing(h) and h > 0]
        if len(valid_heights) >= 2:
            props["upper_fl"] = _m_to_fl(max(valid_heights))
            props["lower_fl"] = _m_to_fl(min(valid_heights))
        elif len(valid_heights) == 1:
            props["upper_fl"] = _m_to_fl(valid_heights[0])

        features.append(SigwxFeature(
            phenomenon=phenomenon,
            geometry_type="Polygon",
            coordinates=[coords],
            properties=props,
        ))

    return features


def _parse_jet_msg(entries: list) -> list[SigwxFeature]:
    """Parse jet stream features from a BUFR message.

    Each jet is a line of lat/lon points, with windSpeed and flightLevel
    at select waypoints (wind symbol positions).
    """
    features: list[SigwxFeature] = []
    feature_groups = _split_into_features(entries)

    for group in feature_groups:
        lats, lons = [], []
        wind_symbols: list[dict] = []
        current_fl = None
        current_ws = None
        coord_idx = 0

        for k, _, v in group:
            if _is_missing(v):
                continue
            if k == "latitude":
                lats.append(v)
                coord_idx = len(lats) - 1
            elif k == "longitude":
                lons.append(v)
            elif k == "flightLevel":
                current_fl = v
            elif k == "windSpeed":
                current_ws = v
                # A wind speed value indicates a wind symbol at the current coord
                if coord_idx < len(lats) and coord_idx < len(lons):
                    symbol: dict = {
                        "position": [lons[coord_idx], lats[coord_idx]],
                        "speed_kt": round(current_ws * 1.94384),
                        "speed_ms": current_ws,
                    }
                    if current_fl is not None:
                        # flightLevel in BUFR is geopotential height in metres
                        symbol["elevation_fl"] = _m_to_fl(current_fl)
                        symbol["elevation_m"] = current_fl
                    wind_symbols.append(symbol)
                    current_fl = None
                    current_ws = None

        if len(lats) < 2:
            continue

        coords = [[lon, lat] for lat, lon in zip(lats, lons)]
        props: dict = {"wind_symbols": wind_symbols}

        features.append(SigwxFeature(
            phenomenon="JETSTREAM",
            geometry_type="LineString",
            coordinates=coords,
            properties=props,
        ))

    return features


def _parse_tropopause_msg(entries: list) -> list[SigwxFeature]:
    """Parse tropopause height contour lines.

    Tropopause data is a series of lat/lon/height points forming contour lines.
    Points at the same height form one contour.
    """
    features: list[SigwxFeature] = []

    # Collect all points with their heights
    points: list[tuple[float, float, float]] = []
    lat_buf, lon_buf, h_buf = None, None, None

    for k, _, v in entries:
        if _is_missing(v):
            continue
        if k == "latitude":
            lat_buf = v
        elif k == "longitude":
            lon_buf = v
        elif k == "nonCoordinateHeight":
            h_buf = v
            if lat_buf is not None and lon_buf is not None:
                points.append((lat_buf, lon_buf, h_buf))
                lat_buf, lon_buf, h_buf = None, None, None

    if not points:
        return []

    # Group points by height to form contour lines
    from collections import defaultdict
    contours: dict[float, list[tuple[float, float]]] = defaultdict(list)
    for lat, lon, h in points:
        contours[h].append((lat, lon))

    for height_m, pts in contours.items():
        if len(pts) < 2:
            continue
        coords = [[lon, lat] for lat, lon in pts]
        fl = _m_to_fl(height_m)
        features.append(SigwxFeature(
            phenomenon="TROPOPAUSE",
            geometry_type="LineString",
            coordinates=coords,
            properties={"elevation_m": height_m, "elevation_fl": fl},
        ))

    return features


def _parse_point_features_msg(entries: list) -> list[SigwxFeature]:
    """Parse tropical cyclones and volcanoes from a point-feature message.

    TC entries have stormName + synopticFeatureType=2.
    Volcano entries have featureName + meteorologicalFeature=17 + specialClouds=5.
    """
    features: list[SigwxFeature] = []

    # Split into TC section and volcano section
    # TCs come before volcanoes in the message structure
    tc_phase = True
    lat_buf, lon_buf = None, None
    storm_name = None
    feat_name = None

    for k, _, v in entries:
        if _is_missing(v):
            continue

        if k == "stormName":
            storm_name = v
            tc_phase = True
        elif k == "featureName":
            feat_name = v
            tc_phase = False
        elif k == "latitude":
            lat_buf = v
        elif k == "longitude":
            lon_buf = v
        elif k == "synopticFeatureType" and v == 2 and storm_name and lat_buf is not None and lon_buf is not None:
            features.append(SigwxFeature(
                phenomenon="TROPICAL_CYCLONE",
                geometry_type="Point",
                coordinates=[lon_buf, lat_buf],
                properties={"name": storm_name},
            ))
            storm_name = None
            lat_buf, lon_buf = None, None
        elif k == "specialClouds" and v == 5 and feat_name and lat_buf is not None and lon_buf is not None:
            features.append(SigwxFeature(
                phenomenon="VOLCANO",
                geometry_type="Point",
                coordinates=[lon_buf, lat_buf],
                properties={"name": feat_name},
            ))
            feat_name = None
            lat_buf, lon_buf = None, None

    return features


def _split_into_features(entries: list) -> list[list]:
    """Split a flat key stream into feature groups.

    BUFR SIGWX message structure per feature:
        meteorologicalFeature (non-missing) → start of feature
        dimensionalSignificance
        height, height (feature-specific levels)
        delayedDescriptorReplicationFactor (coord count)
        latitude/longitude pairs
        phenomenon-specific keys (cloud type, turbulence degree, etc.)
        meteorologicalFeature (MISSING) → separator
        dimensionalSignificance (MISSING) → separator

    Heights and other keys that appear _before_ the first meteorologicalFeature
    are message-level (chart layer bounds), not feature-specific.
    """
    groups: list[list] = []
    current: list = []
    in_feature = False

    for k, idx, v in entries:
        if k == "meteorologicalFeature":
            if _is_missing(v):
                # Missing value = separator, end current feature
                if current:
                    groups.append(current)
                    current = []
                in_feature = False
                continue
            else:
                # Start of a new feature
                if current:
                    groups.append(current)
                current = [(k, idx, v)]
                in_feature = True
        elif in_feature:
            current.append((k, idx, v))
        # Keys before first meteorologicalFeature are message-level — skip

    if current:
        groups.append(current)

    return groups
