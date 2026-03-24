"""Tests for SIGWX IWXXM parser against the official WMO example file."""
from pathlib import Path

from cirrus.decoder.sigwx_parser import parse_sigwx, SigwxFeature

FIXTURE = Path(__file__).parent.parent / "fixtures" / "WAFS-Example.xml"


def _load_fixture() -> tuple:
    assert FIXTURE.exists(), f"Fixture not found: {FIXTURE}"
    return parse_sigwx(FIXTURE.read_bytes())


class TestMetadata:
    def test_originating_centre(self):
        meta, _ = _load_fixture()
        assert meta.originating_centre == "London"

    def test_issue_time(self):
        meta, _ = _load_fixture()
        assert meta.issue_time == "2001-01-30T21:00:00Z"

    def test_phenomenon_time(self):
        meta, _ = _load_fixture()
        assert meta.phenomenon_time == "2001-01-31T00:00:00Z"

    def test_phenomenon_base_time(self):
        meta, _ = _load_fixture()
        assert meta.phenomenon_base_time == "2001-01-30T18:00:00Z"

    def test_phenomena_list(self):
        meta, _ = _load_fixture()
        assert "JETSTREAM" in meta.phenomena
        assert "TURBULENCE" in meta.phenomena
        assert "CLOUD" in meta.phenomena
        assert len(meta.phenomena) == 9


class TestFeatureCount:
    def test_total_features(self):
        _, features = _load_fixture()
        # 9 phenomena: jetstream, turbulence, icing, cloud, tropopause,
        # volcano, sandstorm, tropical cyclone, radiation
        # (online feature ref is skipped — no MeteorologicalFeature child)
        assert len(features) == 9

    def test_phenomenon_types(self):
        _, features = _load_fixture()
        types = {f.phenomenon for f in features}
        assert types == {
            "JETSTREAM", "TURBULENCE", "AIRFRAME_ICING", "CLOUD",
            "TROPOPAUSE", "VOLCANO", "SANDSTORM", "TROPICAL_CYCLONE",
            "RADIATION",
        }


class TestJetStream:
    def _jet(self) -> SigwxFeature:
        _, features = _load_fixture()
        return next(f for f in features if f.phenomenon == "JETSTREAM")

    def test_geometry_type(self):
        jet = self._jet()
        assert jet.geometry_type == "LineString"

    def test_coordinates_lonlat_order(self):
        jet = self._jet()
        # First point in XML: lat=35.4, lon=-104.7
        assert jet.coordinates[0] == [-104.7, 35.4]

    def test_coordinate_count(self):
        jet = self._jet()
        assert len(jet.coordinates) == 11

    def test_wind_symbols(self):
        jet = self._jet()
        symbols = jet.properties["wind_symbols"]
        assert len(symbols) == 5

    def test_wind_symbol_speed(self):
        jet = self._jet()
        symbols = jet.properties["wind_symbols"]
        # First symbol: 51.5 m/s = ~100 kt
        assert symbols[0]["speed_kt"] == 100
        assert symbols[0]["speed_ms"] == 51.5

    def test_wind_symbol_position(self):
        jet = self._jet()
        symbols = jet.properties["wind_symbols"]
        # First symbol: lat=36.1, lon=-101.6 → [lon, lat]
        assert symbols[0]["position"] == [-101.6, 36.1]

    def test_wind_symbol_elevation(self):
        jet = self._jet()
        symbols = jet.properties["wind_symbols"]
        # First symbol: 10668m → FL350
        assert symbols[0]["elevation_fl"] == 350

    def test_isotach_bounds(self):
        jet = self._jet()
        symbols = jet.properties["wind_symbols"]
        # Second symbol has isotach bounds
        assert "isotach_upper_fl" in symbols[1]
        assert "isotach_lower_fl" in symbols[1]
        # 15240m → FL500, 13716m → FL450
        assert symbols[1]["isotach_upper_fl"] == 500
        assert symbols[1]["isotach_lower_fl"] == 450


class TestTurbulence:
    def _turb(self) -> SigwxFeature:
        _, features = _load_fixture()
        return next(f for f in features if f.phenomenon == "TURBULENCE")

    def test_geometry_type(self):
        assert self._turb().geometry_type == "Polygon"

    def test_polygon_ring(self):
        turb = self._turb()
        ring = turb.coordinates[0]
        # First point: lat=44.5, lon=-96.8 → [-96.8, 44.5]
        assert ring[0] == [-96.8, 44.5]
        # Polygon is closed
        assert ring[0] == ring[-1]

    def test_upper_lower_fl(self):
        turb = self._turb()
        # 12192m → FL400, 10363.2m → FL340
        assert turb.properties["upper_fl"] == 400
        assert turb.properties["lower_fl"] == 340

    def test_degree_code(self):
        turb = self._turb()
        assert turb.properties["DegreeOfTurbulence_code"] == "10"


class TestIcing:
    def _icing(self) -> SigwxFeature:
        _, features = _load_fixture()
        return next(f for f in features if f.phenomenon == "AIRFRAME_ICING")

    def test_geometry_type(self):
        assert self._icing().geometry_type == "Polygon"

    def test_fl_from_fl_units(self):
        icing = self._icing()
        # Elevation given in FL units directly
        assert icing.properties["upper_fl"] == 240
        assert icing.properties["lower_fl"] == 100

    def test_degree_code(self):
        assert self._icing().properties["DegreeOfIcing_code"] == "3"


class TestCloud:
    def _cloud(self) -> SigwxFeature:
        _, features = _load_fixture()
        return next(f for f in features if f.phenomenon == "CLOUD")

    def test_geometry_type(self):
        assert self._cloud().geometry_type == "Polygon"

    def test_cloud_distribution(self):
        assert self._cloud().properties["cloud_distribution_code"] == "10"

    def test_cloud_type(self):
        assert self._cloud().properties["cloud_type_code"] == "9"


class TestTropopause:
    def _trop(self) -> SigwxFeature:
        _, features = _load_fixture()
        return next(f for f in features if f.phenomenon == "TROPOPAUSE")

    def test_geometry_type(self):
        assert self._trop().geometry_type == "Polygon"

    def test_elevation(self):
        trop = self._trop()
        assert trop.properties["elevation_m"] == 14020
        # 14020m ≈ FL460
        assert trop.properties["elevation_fl"] == 460


class TestPointFeatures:
    def test_volcano(self):
        _, features = _load_fixture()
        volcano = next(f for f in features if f.phenomenon == "VOLCANO")
        assert volcano.geometry_type == "Point"
        # lat=37.7, lon=15.0 → [15.0, 37.7]
        assert volcano.coordinates == [15.0, 37.7]
        assert volcano.properties["name"] == "ETNA"

    def test_tropical_cyclone(self):
        _, features = _load_fixture()
        tc = next(f for f in features if f.phenomenon == "TROPICAL_CYCLONE")
        assert tc.geometry_type == "Point"
        assert tc.coordinates == [-78.0, 25.0]
        assert tc.properties["name"] == "FRED"

    def test_sandstorm(self):
        _, features = _load_fixture()
        ss = next(f for f in features if f.phenomenon == "SANDSTORM")
        assert ss.geometry_type == "Point"
        assert ss.coordinates == [-78.0, 25.0]

    def test_radiation(self):
        _, features = _load_fixture()
        rad = next(f for f in features if f.phenomenon == "RADIATION")
        assert rad.geometry_type == "Point"
        assert rad.coordinates == [-24.1, 53.2]
