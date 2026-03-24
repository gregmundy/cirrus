# SIGWX Core Rendering (Phase 1)

**Date:** 2026-03-23
**Criterion:** 3a (SIGWX IWXXM Decoder and Display)
**Status:** Approved

## Overview

Render IWXXM SIGWX features on the map — the first vertical slice for Criterion 3. Parser exists from spike (`sigwx_parser.py`). This phase adds DB storage, backend API, and frontend rendering for all 9 phenomenon types with basic color-coded symbology. Advanced rendering (scalloped CB, cubic splines, dashing, label placement) deferred to Phase 2.

## Database

New `sigwx_features` table:

```sql
CREATE TABLE sigwx_features (
    id BIGSERIAL PRIMARY KEY,
    source_file TEXT NOT NULL,
    originating_centre TEXT NOT NULL,
    issue_time TIMESTAMPTZ NOT NULL,
    base_time TIMESTAMPTZ NOT NULL,
    valid_time TIMESTAMPTZ NOT NULL,
    phenomenon TEXT NOT NULL,
    geometry_type TEXT NOT NULL,
    geojson JSONB NOT NULL,
    properties JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_sigwx_valid_time ON sigwx_features(valid_time);
CREATE INDEX idx_sigwx_phenomenon ON sigwx_features(phenomenon);
```

JSONB for geometry (frontend consumes GeoJSON directly). Spatial indexes deferred.

## Decoder

- `sigwx_db.py`: Takes `SigwxMetadata` + `list[SigwxFeature]`, converts to GeoJSON Feature dicts, inserts into `sigwx_features`. Deletes existing features for same `source_file` before inserting (idempotent reload).
- `sigwx_load.py`: CLI entry point `python -m cirrus.decoder.sigwx_load <path>` to load an IWXXM XML file. Used for fixture loading and manual testing.

## Backend API

New `/api/sigwx` endpoint in `sigwx.rs`:
- Query params: `valid_time` (optional — defaults to latest available)
- Returns: `{ valid_time, originating_centre, feature_count, features: [{ phenomenon, geometry_type, geometry, properties }, ...] }`
- Fetches all features for the given valid_time from `sigwx_features`

## Frontend

### SigwxLayer.ts

Layer factories per phenomenon type using Deck.gl:

| Phenomenon | Layer | Color (RGBA) | Style |
|---|---|---|---|
| JETSTREAM | PathLayer + TextLayer (speed labels) | [20, 140, 60, 220] green | 3px line, speed/FL labels at wind symbol positions |
| TURBULENCE | PolygonLayer outline | [255, 160, 0, 180] amber | 2px solid outline, FL range label at centroid |
| AIRFRAME_ICING | PolygonLayer outline | [0, 180, 220, 180] cyan | 2px solid outline, FL range label at centroid |
| CLOUD | PolygonLayer outline + fill | [220, 40, 40, 160] red | 2px outline, light fill, cloud type label at centroid |
| TROPOPAUSE | PolygonLayer outline | [100, 180, 240, 180] light blue | 1.5px outline, FL label at centroid |
| VOLCANO | ScatterplotLayer + TextLayer | [220, 30, 30, 255] red | Triangle-ish marker (large dot), name label |
| TROPICAL_CYCLONE | ScatterplotLayer + TextLayer | [160, 40, 200, 255] purple | Large dot, name label |
| SANDSTORM | ScatterplotLayer | [220, 180, 30, 255] yellow | Medium dot |
| RADIATION | ScatterplotLayer + TextLayer | [200, 40, 200, 255] magenta | Medium dot, "RADIATION" label |

All polygon phenomena use `PathLayer` for outlines (not `PolygonLayer`) to avoid fill overlap issues. Cloud/CB gets a `SolidPolygonLayer` with low-opacity fill underneath.

### Store (appStore.ts)

Add: `sigwxVisible`, `sigwxFeatures` (raw GeoJSON array), `sigwxLoading`, `sigwxError`, `toggleSigwx`, `fetchSigwxData`.

Fetch calls `/api/sigwx` with the current forecast valid time. Cache invalidated on run/forecast hour changes.

### Toolbar

Add "SIGWX" toggle button after the Jet button.

### MapView

Wire in SIGWX layers conditionally when `sigwxVisible && sigwxFeatures.length > 0`.

## Changes by File

| Service | File | Change |
|---|---|---|
| DB | `db/migrations/003_sigwx_features.sql` | Create table + indexes |
| Decoder | `src/cirrus/decoder/sigwx_db.py` (new) | Store parsed features |
| Decoder | `src/cirrus/decoder/sigwx_load.py` (new) | CLI loader |
| Backend | `src/sigwx.rs` (new) | `/api/sigwx` endpoint |
| Backend | `src/main.rs` | Register route |
| Frontend | `src/components/map/SigwxLayer.ts` (new) | All phenomenon layer factories |
| Frontend | `src/stores/appStore.ts` | SIGWX state/toggle/fetch |
| Frontend | `src/components/Toolbar.tsx` | SIGWX toggle button |
| Frontend | `src/components/map/MapView.tsx` | Wire in SIGWX layers |

## Not in Scope (Phase 2)

- Scalloped CB boundary rendering
- Cubic spline interpolation for smooth curves
- Turbulence dashing patterns
- Automatic label placement (constraint solver)
- Time slider for T+6 to T+48
- SIGWX data acquisition from SADIS/WIFS
- WAFC attribution stripping on modification (3a.10)
