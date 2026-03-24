"""IWXXM SIGWX parser — extracts meteorological features from WAFS SIGWX XML.

Parses WAFSSignificantWeatherForecast documents into GeoJSON-compatible
feature dicts for storage and frontend rendering.
"""

import logging
from dataclasses import dataclass, field
from lxml import etree

logger = logging.getLogger(__name__)

# Namespace map for XPath queries
NS = {
    "iwxxm": "http://icao.int/iwxxm/2025-2",
    "gml": "http://www.opengis.net/gml/3.2",
    "xlink": "http://www.w3.org/1999/xlink",
    "xsi": "http://www.w3.org/2001/XMLSchema-instance",
}

# Phenomenon type from xlink:href suffix
PHENOMENON_TYPES = {
    "JETSTREAM",
    "TURBULENCE",
    "AIRFRAME_ICING",
    "CLOUD",
    "TROPOPAUSE",
    "VOLCANO",
    "SANDSTORM",
    "TROPICAL_CYCLONE",
    "RADIATION",
}


@dataclass
class SigwxMetadata:
    """Collection-level metadata from the SIGWX forecast."""
    identifier: str = ""
    issue_time: str = ""
    phenomenon_base_time: str = ""
    phenomenon_time: str = ""
    originating_centre: str = ""  # "London" or "Washington"
    phenomena: list[str] = field(default_factory=list)


@dataclass
class SigwxFeature:
    """A single SIGWX feature extracted from the XML."""
    phenomenon: str  # e.g., "JETSTREAM", "TURBULENCE"
    geometry_type: str  # "Point", "LineString", "Polygon"
    coordinates: list  # GeoJSON-style [lon, lat] coordinates
    properties: dict = field(default_factory=dict)


def parse_sigwx(xml_bytes: bytes) -> tuple[SigwxMetadata, list[SigwxFeature]]:
    """Parse a WAFSSignificantWeatherForecast XML document.

    Args:
        xml_bytes: Raw XML content as bytes.

    Returns:
        Tuple of (metadata, list of features).
    """
    root = etree.fromstring(xml_bytes)
    metadata = _parse_metadata(root)
    features = []

    for feature_el in root.findall("iwxxm:feature", NS):
        met_feature = feature_el.find("iwxxm:MeteorologicalFeature", NS)
        if met_feature is None:
            continue

        try:
            parsed = _parse_feature(met_feature)
            if parsed:
                features.append(parsed)
        except Exception:
            logger.exception("Failed to parse SIGWX feature, skipping")

    logger.info(
        "Parsed SIGWX: %s, %s, %d features (%s)",
        metadata.originating_centre,
        metadata.phenomenon_time,
        len(features),
        ", ".join(f.phenomenon for f in features),
    )
    return metadata, features


def _parse_metadata(root: etree._Element) -> SigwxMetadata:
    """Extract collection-level metadata."""
    meta = SigwxMetadata()

    ident = root.find("gml:identifier", NS)
    if ident is not None:
        meta.identifier = ident.text or ""

    # Issue time
    issue_pos = root.find(".//iwxxm:issueTime//gml:timePosition", NS)
    if issue_pos is not None:
        meta.issue_time = issue_pos.text or ""

    # Phenomenon base time (forecast run time)
    base_pos = root.find(".//iwxxm:phenomenonBaseTime//gml:timePosition", NS)
    if base_pos is not None:
        meta.phenomenon_base_time = base_pos.text or ""

    # Phenomenon time (valid time)
    phen_pos = root.find(".//iwxxm:phenomenonTime//gml:timePosition", NS)
    if phen_pos is not None:
        meta.phenomenon_time = phen_pos.text or ""

    # Originating centre
    centre = root.find(".//iwxxm:originatingCentre/iwxxm:WorldAreaForecastCentre", NS)
    if centre is not None:
        meta.originating_centre = centre.text or ""

    # Phenomena list
    for phen in root.findall("iwxxm:phenomenaList", NS):
        href = phen.get(f"{{{NS['xlink']}}}href", "")
        ptype = href.rsplit("/", 1)[-1] if "/" in href else href
        if ptype in PHENOMENON_TYPES:
            meta.phenomena.append(ptype)

    return meta


def _parse_feature(el: etree._Element) -> SigwxFeature | None:
    """Parse a single MeteorologicalFeature element."""
    # Determine phenomenon type
    phen_el = el.find("iwxxm:phenomenon", NS)
    if phen_el is None:
        return None
    href = phen_el.get(f"{{{NS['xlink']}}}href", "")
    phenomenon = href.rsplit("/", 1)[-1] if "/" in href else ""
    if phenomenon not in PHENOMENON_TYPES:
        return None

    # Parse geometry
    geom_el = el.find("iwxxm:phenomenonGeometry", NS)
    if geom_el is None:
        return None

    geometry_type, coordinates = _parse_geometry(geom_el)
    if geometry_type is None:
        return None

    # Parse properties based on phenomenon type
    properties = _parse_properties(el, phenomenon)

    return SigwxFeature(
        phenomenon=phenomenon,
        geometry_type=geometry_type,
        coordinates=coordinates,
        properties=properties,
    )


def _parse_geometry(geom_el: etree._Element) -> tuple[str | None, list]:
    """Parse phenomenonGeometry into GeoJSON-compatible geometry.

    GML uses lat,lon order — we convert to lon,lat for GeoJSON.
    """
    # Point geometry
    point = geom_el.find(".//gml:Point", NS)
    if point is not None:
        pos = point.find("gml:pos", NS)
        if pos is not None and pos.text:
            coords = [float(x) for x in pos.text.strip().split()]
            if len(coords) >= 2:
                return "Point", [coords[1], coords[0]]  # lon, lat

    # Curve geometry (jet streams)
    curve = geom_el.find("gml:Curve", NS)
    if curve is not None:
        coords = _parse_curve_coords(curve)
        if coords:
            return "LineString", coords

    # ElevatedVolume with polygon (turbulence, icing, cloud)
    volume = geom_el.find("iwxxm:ElevatedVolume", NS)
    if volume is not None:
        coords = _parse_polygon_coords(volume)
        if coords:
            return "Polygon", [coords]  # GeoJSON polygon = array of rings

    # Plain polygon (tropopause)
    polygon = geom_el.find("gml:Polygon", NS)
    if polygon is not None:
        coords = _parse_polygon_coords(polygon)
        if coords:
            return "Polygon", [coords]

    return None, []


def _parse_curve_coords(curve_el: etree._Element) -> list[list[float]]:
    """Extract coordinates from a gml:Curve with CubicSpline segments.

    For the spike, we use the control points directly (piecewise linear).
    Full implementation would interpolate the cubic spline.
    """
    pos_list = curve_el.find(".//gml:CubicSpline/gml:posList", NS)
    if pos_list is None or not pos_list.text:
        return []

    values = [float(x) for x in pos_list.text.strip().split()]
    coords = []
    for i in range(0, len(values) - 1, 2):
        lat, lon = values[i], values[i + 1]
        coords.append([lon, lat])  # GeoJSON order
    return coords


def _parse_polygon_coords(parent_el: etree._Element) -> list[list[float]]:
    """Extract polygon ring coordinates from gml:PolygonPatch or gml:Polygon."""
    # Look for CubicSpline posList inside the polygon structure
    pos_list = parent_el.find(".//gml:CubicSpline/gml:posList", NS)
    if pos_list is None or not pos_list.text:
        return []

    values = [float(x) for x in pos_list.text.strip().split()]
    coords = []
    for i in range(0, len(values) - 1, 2):
        lat, lon = values[i], values[i + 1]
        coords.append([lon, lat])  # GeoJSON order
    return coords


def _parse_properties(el: etree._Element, phenomenon: str) -> dict:
    """Extract phenomenon-specific properties."""
    props: dict = {}

    if phenomenon == "JETSTREAM":
        _parse_jet_properties(el, props)
    elif phenomenon == "TURBULENCE":
        _parse_elevated_volume_props(el, props)
        _parse_degree_prop(el, "DegreeOfTurbulence", props)
    elif phenomenon == "AIRFRAME_ICING":
        _parse_elevated_volume_props(el, props)
        _parse_degree_prop(el, "DegreeOfIcing", props)
    elif phenomenon == "CLOUD":
        _parse_elevated_volume_props(el, props)
        _parse_cloud_props(el, props)
    elif phenomenon == "TROPOPAUSE":
        elev = el.find(".//iwxxm:ElevatedLevel/iwxxm:elevation", NS)
        if elev is not None and elev.text:
            props["elevation_m"] = float(elev.text)
            props["elevation_fl"] = round(float(elev.text) * 3.28084 / 100)
    elif phenomenon == "VOLCANO":
        name = el.find(".//iwxxm:Volcano/iwxxm:name", NS)
        if name is not None and name.text:
            props["name"] = name.text
    elif phenomenon == "TROPICAL_CYCLONE":
        name = el.find(".//iwxxm:TropicalCyclone/iwxxm:name", NS)
        if name is not None and name.text:
            props["name"] = name.text
    elif phenomenon == "RADIATION":
        site = el.find(".//iwxxm:RadiationIncident/iwxxm:siteName", NS)
        if site is not None and site.text:
            props["site_name"] = site.text

    return props


def _parse_jet_properties(el: etree._Element, props: dict) -> None:
    """Parse jet stream wind symbols (speed, elevation, isotach bounds)."""
    symbols = []
    for ws_el in el.findall(".//iwxxm:WAFSJetStreamWindSymbol", NS):
        symbol: dict = {}

        # Location
        pos = ws_el.find(".//gml:pos", NS)
        if pos is not None and pos.text:
            coords = [float(x) for x in pos.text.strip().split()]
            if len(coords) >= 2:
                symbol["position"] = [coords[1], coords[0]]  # lon, lat

        # Elevation
        elev = ws_el.find("iwxxm:location//iwxxm:elevation", NS)
        if elev is not None and elev.text:
            uom = elev.get("uom", "M")
            val = float(elev.text)
            if uom == "M":
                symbol["elevation_m"] = val
                symbol["elevation_fl"] = round(val * 3.28084 / 100)
            elif uom == "FL":
                symbol["elevation_fl"] = int(val)
                symbol["elevation_m"] = val * 100 / 3.28084

        # Wind speed
        speed = ws_el.find("iwxxm:windSpeed", NS)
        if speed is not None and speed.text:
            uom = speed.get("uom", "m/s")
            val = float(speed.text)
            if uom == "m/s":
                symbol["speed_kt"] = round(val * 1.94384)
                symbol["speed_ms"] = val
            else:
                symbol["speed_kt"] = round(val)

        # Isotach bounds (optional)
        upper = ws_el.find("iwxxm:IsotachUpperElevation", NS)
        lower = ws_el.find("iwxxm:IsotachLowerElevation", NS)
        if upper is not None and upper.text and lower is not None and lower.text:
            uom_u = upper.get("uom", "M")
            uom_l = lower.get("uom", "M")
            u_val = float(upper.text)
            l_val = float(lower.text)
            if uom_u == "M":
                symbol["isotach_upper_fl"] = round(u_val * 3.28084 / 100)
            elif uom_u == "FL":
                symbol["isotach_upper_fl"] = int(u_val)
            if uom_l == "M":
                symbol["isotach_lower_fl"] = round(l_val * 3.28084 / 100)
            elif uom_l == "FL":
                symbol["isotach_lower_fl"] = int(l_val)

        symbols.append(symbol)

    props["wind_symbols"] = symbols


def _parse_elevated_volume_props(el: etree._Element, props: dict) -> None:
    """Extract upper/lower elevation from ElevatedVolume."""
    geom = el.find(".//iwxxm:ElevatedVolume", NS)
    if geom is None:
        return

    upper = geom.find("iwxxm:upperElevation", NS)
    if upper is not None and upper.text:
        uom = upper.get("uom", "M")
        val = float(upper.text)
        if uom == "FL":
            props["upper_fl"] = int(val)
        else:
            props["upper_fl"] = round(val * 3.28084 / 100)

    lower = geom.find("iwxxm:lowerElevation", NS)
    if lower is not None and lower.text:
        uom = lower.get("uom", "M")
        val = float(lower.text)
        if uom == "FL":
            props["lower_fl"] = int(val)
        else:
            props["lower_fl"] = round(val * 3.28084 / 100)


def _parse_degree_prop(el: etree._Element, tag: str, props: dict) -> None:
    """Extract degree of turbulence or icing from xlink:href code."""
    degree_el = el.find(f".//iwxxm:{tag}", NS)
    if degree_el is not None:
        href = degree_el.get(f"{{{NS['xlink']}}}href", "")
        # Extract code value from URL like .../0-11-030/10
        if "/" in href:
            code = href.rsplit("/", 1)[-1]
            props[f"{tag}_code"] = code


def _parse_cloud_props(el: etree._Element, props: dict) -> None:
    """Extract cloud distribution and type."""
    dist = el.find(".//iwxxm:CloudDistribution", NS)
    if dist is not None:
        href = dist.get(f"{{{NS['xlink']}}}href", "")
        if "/" in href:
            props["cloud_distribution_code"] = href.rsplit("/", 1)[-1]

    ctype = el.find(".//iwxxm:CloudType", NS)
    if ctype is not None:
        href = ctype.get(f"{{{NS['xlink']}}}href", "")
        if "/" in href:
            props["cloud_type_code"] = href.rsplit("/", 1)[-1]
