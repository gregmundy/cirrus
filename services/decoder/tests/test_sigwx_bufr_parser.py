"""Tests for SIGWX BUFR parser using real NWS BUFR data."""
from pathlib import Path

import pytest

from cirrus.decoder.sigwx_bufr_parser import parse_sigwx_bufr

FIXTURE = Path(__file__).parent.parent / "fixtures" / "sigwx_bufr_sample.bufr"


@pytest.fixture
def parsed():
    data = FIXTURE.read_bytes()
    return parse_sigwx_bufr(data)


@pytest.fixture
def metadata(parsed):
    return parsed[0]


@pytest.fixture
def features(parsed):
    return parsed[1]


def _by_type(features, phenomenon):
    return [f for f in features if f.phenomenon == phenomenon]


class TestMetadata:
    def test_originating_centre(self, metadata):
        assert metadata.originating_centre == "Washington"

    def test_issue_time(self, metadata):
        assert "2026-04-06" in metadata.issue_time

    def test_phenomenon_time(self, metadata):
        assert "2026-04-07" in metadata.phenomenon_time


class TestFeatureCounts:
    def test_total_features(self, features):
        assert len(features) > 200

    def test_has_all_types(self, features):
        types = {f.phenomenon for f in features}
        assert types == {"CLOUD", "TURBULENCE", "JETSTREAM", "TROPOPAUSE", "TROPICAL_CYCLONE", "VOLCANO"}


class TestCloudFeatures:
    def test_cloud_count(self, features):
        clouds = _by_type(features, "CLOUD")
        assert len(clouds) >= 30

    def test_cloud_is_polygon(self, features):
        clouds = _by_type(features, "CLOUD")
        for c in clouds:
            assert c.geometry_type == "Polygon"

    def test_cloud_polygon_closed(self, features):
        clouds = _by_type(features, "CLOUD")
        for c in clouds:
            ring = c.coordinates[0]
            assert ring[0] == ring[-1], "Polygon ring should be closed"

    def test_cloud_has_cb_type(self, features):
        clouds = _by_type(features, "CLOUD")
        cb_clouds = [c for c in clouds if c.properties.get("cloud_type_code") == "CB"]
        assert len(cb_clouds) > 0

    def test_cloud_has_distribution(self, features):
        clouds = _by_type(features, "CLOUD")
        assert all("cloud_distribution_code" in c.properties for c in clouds)

    def test_cloud_has_top_fl(self, features):
        clouds = _by_type(features, "CLOUD")
        with_top = [c for c in clouds if "upper_fl" in c.properties]
        assert len(with_top) > 0
        for c in with_top:
            assert 200 <= c.properties["upper_fl"] <= 600


class TestTurbulenceFeatures:
    def test_turbulence_count(self, features):
        turbs = _by_type(features, "TURBULENCE")
        assert len(turbs) >= 30

    def test_turbulence_is_polygon(self, features):
        turbs = _by_type(features, "TURBULENCE")
        for t in turbs:
            assert t.geometry_type == "Polygon"

    def test_turbulence_has_severity(self, features):
        turbs = _by_type(features, "TURBULENCE")
        assert all("severity" in t.properties for t in turbs)
        severities = {t.properties["severity"] for t in turbs}
        assert "MODERATE" in severities

    def test_turbulence_fl_range(self, features):
        turbs = _by_type(features, "TURBULENCE")
        with_fl = [t for t in turbs if "upper_fl" in t.properties and "lower_fl" in t.properties]
        assert len(with_fl) > 0
        for t in with_fl:
            assert t.properties["upper_fl"] > t.properties["lower_fl"]


class TestJetStreamFeatures:
    def test_jet_count(self, features):
        jets = _by_type(features, "JETSTREAM")
        assert len(jets) >= 50

    def test_jet_is_linestring(self, features):
        jets = _by_type(features, "JETSTREAM")
        for j in jets:
            assert j.geometry_type == "LineString"

    def test_jet_has_wind_symbols(self, features):
        jets = _by_type(features, "JETSTREAM")
        with_symbols = [j for j in jets if j.properties.get("wind_symbols")]
        assert len(with_symbols) > 0

    def test_wind_symbol_structure(self, features):
        jets = _by_type(features, "JETSTREAM")
        for j in jets:
            for ws in j.properties.get("wind_symbols", []):
                assert "position" in ws
                assert "speed_kt" in ws
                assert len(ws["position"]) == 2

    def test_wind_speed_range(self, features):
        jets = _by_type(features, "JETSTREAM")
        for j in jets:
            for ws in j.properties.get("wind_symbols", []):
                assert 50 <= ws["speed_kt"] <= 300

    def test_jet_fl_range(self, features):
        jets = _by_type(features, "JETSTREAM")
        for j in jets:
            for ws in j.properties.get("wind_symbols", []):
                if "elevation_fl" in ws:
                    assert 200 <= ws["elevation_fl"] <= 500


class TestTropopauseFeatures:
    def test_tropopause_count(self, features):
        tropos = _by_type(features, "TROPOPAUSE")
        assert len(tropos) >= 5

    def test_tropopause_is_linestring(self, features):
        tropos = _by_type(features, "TROPOPAUSE")
        for t in tropos:
            assert t.geometry_type == "LineString"

    def test_tropopause_has_elevation(self, features):
        tropos = _by_type(features, "TROPOPAUSE")
        assert all("elevation_fl" in t.properties for t in tropos)
        fls = {t.properties["elevation_fl"] for t in tropos}
        assert len(fls) > 1  # Multiple contour levels


class TestTropicalCyclones:
    def test_tc_count(self, features):
        tcs = _by_type(features, "TROPICAL_CYCLONE")
        assert len(tcs) == 2

    def test_tc_names(self, features):
        tcs = _by_type(features, "TROPICAL_CYCLONE")
        names = {tc.properties["name"] for tc in tcs}
        assert "MAILA" in names
        assert "VAIANU" in names

    def test_tc_is_point(self, features):
        tcs = _by_type(features, "TROPICAL_CYCLONE")
        for tc in tcs:
            assert tc.geometry_type == "Point"
            assert len(tc.coordinates) == 2


class TestVolcanoes:
    def test_volcano_count(self, features):
        volcs = _by_type(features, "VOLCANO")
        assert len(volcs) >= 10

    def test_volcano_has_name(self, features):
        volcs = _by_type(features, "VOLCANO")
        assert all("name" in v.properties for v in volcs)
        names = {v.properties["name"] for v in volcs}
        assert "MAYON" in names
        assert "POPOCATEPETL" in names

    def test_volcano_is_point(self, features):
        volcs = _by_type(features, "VOLCANO")
        for v in volcs:
            assert v.geometry_type == "Point"


class TestChartLevels:
    """Verify SWH/SWM chart level classification."""

    def test_all_features_have_chart_level(self, features):
        for f in features:
            assert "chart_level" in f.properties, f"{f.phenomenon} missing chart_level"

    def test_only_swh_and_swm(self, features):
        levels = {f.properties["chart_level"] for f in features}
        assert levels == {"SWH", "SWM"}

    def test_swh_count(self, features):
        swh = [f for f in features if f.properties["chart_level"] == "SWH"]
        assert len(swh) > 100

    def test_swm_count(self, features):
        swm = [f for f in features if f.properties["chart_level"] == "SWM"]
        assert len(swm) > 50

    def test_swh_has_jets_turb_cloud_tropo(self, features):
        swh_types = {f.phenomenon for f in features if f.properties["chart_level"] == "SWH"}
        assert "JETSTREAM" in swh_types
        assert "TURBULENCE" in swh_types
        assert "CLOUD" in swh_types
        assert "TROPOPAUSE" in swh_types

    def test_swm_has_jets_and_turb(self, features):
        swm_types = {f.phenomenon for f in features if f.properties["chart_level"] == "SWM"}
        assert "JETSTREAM" in swm_types
        assert "TURBULENCE" in swm_types

    def test_point_features_tagged_swh(self, features):
        """TC and volcano point features span full range, tagged as SWH."""
        points = [f for f in features if f.phenomenon in ("TROPICAL_CYCLONE", "VOLCANO")]
        for p in points:
            assert p.properties["chart_level"] == "SWH"


class TestGeoJSONCompatibility:
    """Verify output matches the structure expected by the frontend."""

    def test_polygon_coordinates_nested(self, features):
        polygons = [f for f in features if f.geometry_type == "Polygon"]
        for p in polygons:
            assert isinstance(p.coordinates, list)
            assert isinstance(p.coordinates[0], list)  # outer ring
            assert isinstance(p.coordinates[0][0], list)  # first coord pair
            assert len(p.coordinates[0][0]) == 2  # [lon, lat]

    def test_linestring_coordinates(self, features):
        lines = [f for f in features if f.geometry_type == "LineString"]
        for l in lines:
            assert isinstance(l.coordinates, list)
            assert isinstance(l.coordinates[0], list)
            assert len(l.coordinates[0]) == 2

    def test_point_coordinates(self, features):
        points = [f for f in features if f.geometry_type == "Point"]
        for p in points:
            assert isinstance(p.coordinates, list)
            assert len(p.coordinates) == 2
            assert isinstance(p.coordinates[0], float)

    def test_lon_lat_range(self, features):
        for f in features:
            if f.geometry_type == "Point":
                lon, lat = f.coordinates
                assert -180 <= lon <= 180
                assert -90 <= lat <= 90
            elif f.geometry_type == "LineString":
                for lon, lat in f.coordinates:
                    assert -180 <= lon <= 180, f"lon {lon} out of range"
                    assert -90 <= lat <= 90, f"lat {lat} out of range"
