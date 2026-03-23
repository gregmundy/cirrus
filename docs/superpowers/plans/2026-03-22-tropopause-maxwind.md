# Tropopause + Max Wind (Jet Stream) Display — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add tropopause height contours (dotted blue lines labeled with FL) and max wind / jet stream display (isotach contours + wind barbs at ≥60kt) to the map.

**Architecture:** Extend the existing GRIB2 pipeline end-to-end. Acquisition adds `lev_max_wind=on`. Decoder adds surface type 6 handling. Backend gets a `level_type` filter on `/api/gridded` and a new `/api/maxwind` endpoint. Frontend adds two new toggleable layers following the existing contour pattern, plus a green wind barb atlas for jet stream barbs.

**Tech Stack:** Rust (Axum, sqlx), Python (ecCodes), React 18, TypeScript 5, Zustand, Deck.gl (PathLayer with PathStyleExtension, IconLayer, TextLayer), d3-contour (via existing Web Worker)

**Spec:** `docs/superpowers/specs/2026-03-22-tropopause-maxwind-design.md`

---

## File Structure

### Files to Modify
| File | Change |
|------|--------|
| `services/acquisition/src/nomads.rs:13-18` | Add `"lev_max_wind=on"` to LEVELS |
| `services/decoder/src/cirrus/decoder/grib_decoder.py:20,52-59` | Add MAX_WIND_SURFACE_TYPE=6 and elif branch |
| `services/backend/src/gridded.rs:10-17,68-71` | Add optional `level_type` query param + WHERE clause |
| `services/backend/src/main.rs:38-44` | Register `/api/maxwind` route |
| `services/frontend/src/utils/contourWorker.ts:8,24` | Add `'tropopause'` to type union |
| `services/frontend/src/utils/contourWorkerClient.ts` | No changes needed (generic) |
| `services/frontend/src/stores/appStore.ts` | Add tropopause + maxWind state, toggles, fetchers, cache invalidation |
| `services/frontend/src/components/map/ContourLayer.ts` | Add `createTropopauseLayers()` and `createMaxWindIsotachLayers()` |
| `services/frontend/src/components/map/MapView.tsx` | Wire in new layers, green barb atlas, new store selectors |
| `services/frontend/src/components/Toolbar.tsx` | Add Trop and Jet toggle buttons |
| `services/frontend/src/utils/windBarbAtlas.ts` | Add `getJetWindBarbAtlas()` (green color) |

### Files to Create
| File | Purpose |
|------|---------|
| `services/backend/src/maxwind.rs` | `/api/maxwind` endpoint — fetches U/V/PRES at level_type=maxwind, returns speed/direction/FL |
| `services/decoder/tests/test_grib_decoder_maxwind.py` | Tests for max wind surface type 6 decoding |

---

## Task 1: Acquisition — Add Max Wind Level

**Files:**
- Modify: `services/acquisition/src/nomads.rs:13-18`

- [ ] **Step 1: Add `lev_max_wind=on` to LEVELS array**

In `services/acquisition/src/nomads.rs`, add `"lev_max_wind=on"` to the `LEVELS` constant:

```rust
const LEVELS: &[&str] = &[
    "lev_70_mb=on", "lev_100_mb=on", "lev_150_mb=on", "lev_200_mb=on",
    "lev_250_mb=on", "lev_300_mb=on", "lev_400_mb=on", "lev_500_mb=on",
    "lev_600_mb=on", "lev_700_mb=on", "lev_850_mb=on",
    "lev_tropopause=on",
    "lev_max_wind=on",
];
```

- [ ] **Step 2: Update test assertion**

The existing `test_build_url` test should also verify the new level. Add this assertion at line 123:

```rust
assert!(url.contains("lev_max_wind=on"));
```

- [ ] **Step 3: Run tests**

Run: `cd services && cargo test -p acquisition -- --nocapture`
Expected: All tests pass, URL contains `lev_max_wind=on`.

- [ ] **Step 4: Commit**

```bash
git add services/acquisition/src/nomads.rs
git commit -m "feat(acquisition): add max wind level to NOMADS GFS download"
```

---

## Task 2: Decoder — Handle Max Wind Surface Type 6

**Files:**
- Modify: `services/decoder/src/cirrus/decoder/grib_decoder.py:20,52-59`
- Create: `services/decoder/tests/test_grib_decoder_maxwind.py`

- [ ] **Step 1: Write test for max wind surface type handling**

Create `services/decoder/tests/test_grib_decoder_maxwind.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/decoder && python -m pytest tests/test_grib_decoder_maxwind.py -v`
Expected: FAIL — `MAX_WIND_SURFACE_TYPE` not defined.

- [ ] **Step 3: Implement max wind surface type handling**

In `services/decoder/src/cirrus/decoder/grib_decoder.py`, add the constant at line 21:

```python
MAX_WIND_SURFACE_TYPE = 6
```

Then modify the if/elif/else block at lines 54-59:

```python
    if level_type_int == TROPOPAUSE_SURFACE_TYPE:
        level_hpa = -1
        level_type = "tropopause"
    elif level_type_int == MAX_WIND_SURFACE_TYPE:
        level_hpa = -1
        level_type = "maxwind"
    else:
        level_hpa = eccodes.codes_get(msgid, "level")
        level_type = "isobaricInhPa"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/decoder && python -m pytest tests/test_grib_decoder_maxwind.py -v`
Expected: All 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add services/decoder/src/cirrus/decoder/grib_decoder.py services/decoder/tests/test_grib_decoder_maxwind.py
git commit -m "feat(decoder): handle max wind surface type 6 in GRIB2 decoder"
```

---

## Task 3: Backend — Add `level_type` Filter to `/api/gridded`

**Files:**
- Modify: `services/backend/src/gridded.rs:10-17,68-76`

- [ ] **Step 1: Add optional `level_type` field to `GriddedQuery`**

In `services/backend/src/gridded.rs`, add `level_type` to the query struct:

```rust
#[derive(Deserialize)]
pub struct GriddedQuery {
    parameter: String,
    level_hpa: i32,
    forecast_hour: i32,
    run_time: Option<DateTime<Utc>>,
    thin: Option<usize>,
    level_type: Option<String>,
}
```

- [ ] **Step 2: Update the SQL query to optionally filter by level_type**

Replace the fetch query (lines 68-76) with a conditional query:

```rust
    // Fetch the gridded field
    let row = if let Some(ref lt) = params.level_type {
        sqlx::query_as::<_, GridRow>(
            "SELECT run_time, valid_time, ni, nj, lat_first, lat_last, lon_first, d_lat, d_lon, values \
             FROM gridded_fields \
             WHERE parameter = $1 AND level_hpa = $2 AND forecast_hour = $3 AND run_time = $4 AND level_type = $5"
        )
        .bind(&params.parameter)
        .bind(params.level_hpa)
        .bind(params.forecast_hour)
        .bind(run_time)
        .bind(lt)
        .fetch_optional(&pool)
        .await
    } else {
        sqlx::query_as::<_, GridRow>(
            "SELECT run_time, valid_time, ni, nj, lat_first, lat_last, lon_first, d_lat, d_lon, values \
             FROM gridded_fields \
             WHERE parameter = $1 AND level_hpa = $2 AND forecast_hour = $3 AND run_time = $4"
        )
        .bind(&params.parameter)
        .bind(params.level_hpa)
        .bind(params.forecast_hour)
        .bind(run_time)
        .fetch_optional(&pool)
        .await
    }
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .ok_or(StatusCode::NOT_FOUND)?;
```

- [ ] **Step 3: Build and test**

Run: `cd services && cargo build -p backend`
Expected: Compiles without errors. Existing behavior unchanged (level_type is optional).

- [ ] **Step 4: Commit**

```bash
git add services/backend/src/gridded.rs
git commit -m "feat(backend): add optional level_type filter to /api/gridded endpoint"
```

---

## Task 4: Backend — New `/api/maxwind` Endpoint

**Files:**
- Create: `services/backend/src/maxwind.rs`
- Modify: `services/backend/src/main.rs:1,38-44`

- [ ] **Step 1: Create maxwind.rs**

Create `services/backend/src/maxwind.rs`. This endpoint fetches UGRD, VGRD, and PRES at `level_type='maxwind'`, computes wind speed (kt), direction, and converts pressure to flight level:

```rust
use axum::{
    extract::{Query, State},
    http::StatusCode,
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Deserialize)]
pub struct MaxWindQuery {
    forecast_hour: i32,
    run_time: Option<DateTime<Utc>>,
    thin: Option<usize>,
}

#[derive(Serialize)]
pub struct MaxWindResponse {
    run_time: DateTime<Utc>,
    forecast_hour: i32,
    valid_time: DateTime<Utc>,
    count: usize,
    lats: Vec<f32>,
    lons: Vec<f32>,
    speeds: Vec<f32>,
    directions: Vec<f32>,
    flight_levels: Vec<f32>,
}

#[derive(sqlx::FromRow)]
struct GriddedRow {
    run_time: DateTime<Utc>,
    valid_time: DateTime<Utc>,
    ni: i32,
    nj: i32,
    lat_first: f64,
    lat_last: f64,
    lon_first: f64,
    d_lat: f64,
    d_lon: f64,
    values: Vec<u8>,
}

const MAXWIND_QUERY: &str =
    "SELECT run_time, valid_time, ni, nj, lat_first, lat_last, lon_first, d_lat, d_lon, values \
     FROM gridded_fields \
     WHERE parameter = $1 AND level_hpa = -1 AND level_type = 'maxwind' \
     AND forecast_hour = $2 AND run_time = $3";

pub async fn get_maxwind(
    State(pool): State<PgPool>,
    Query(params): Query<MaxWindQuery>,
) -> Result<Json<MaxWindResponse>, StatusCode> {
    let thin = params.thin.unwrap_or(4).max(1);

    // Resolve run_time
    let run_time = match params.run_time {
        Some(rt) => rt,
        None => {
            sqlx::query_scalar::<_, DateTime<Utc>>(
                "SELECT DISTINCT run_time FROM gridded_fields ORDER BY run_time DESC LIMIT 1"
            )
            .fetch_optional(&pool)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
            .ok_or(StatusCode::NOT_FOUND)?
        }
    };

    // Fetch UGRD, VGRD, PRES at maxwind level
    let u_row = sqlx::query_as::<_, GriddedRow>(MAXWIND_QUERY)
        .bind("UGRD").bind(params.forecast_hour).bind(run_time)
        .fetch_optional(&pool).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;

    let v_row = sqlx::query_as::<_, GriddedRow>(MAXWIND_QUERY)
        .bind("VGRD").bind(params.forecast_hour).bind(run_time)
        .fetch_optional(&pool).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;

    let p_row = sqlx::query_as::<_, GriddedRow>(MAXWIND_QUERY)
        .bind("PRES").bind(params.forecast_hour).bind(run_time)
        .fetch_optional(&pool).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;

    let u_vals = bytes_to_f32(&u_row.values);
    let v_vals = bytes_to_f32(&v_row.values);
    let p_vals = bytes_to_f32(&p_row.values);

    let ni = u_row.ni as usize;
    let nj = u_row.nj as usize;

    let d_lat = if u_row.lat_first > u_row.lat_last {
        -u_row.d_lat.abs()
    } else {
        u_row.d_lat.abs()
    };
    let d_lon = u_row.d_lon;

    let mut lats = Vec::new();
    let mut lons = Vec::new();
    let mut speeds = Vec::new();
    let mut directions = Vec::new();
    let mut flight_levels = Vec::new();

    for j in (0..nj).step_by(thin) {
        for i in (0..ni).step_by(thin) {
            let idx = j * ni + i;
            if idx >= u_vals.len() || idx >= v_vals.len() || idx >= p_vals.len() {
                continue;
            }

            let u = u_vals[idx] as f64;
            let v = v_vals[idx] as f64;
            let pres_pa = p_vals[idx] as f64;

            let lat = u_row.lat_first + (j as f64) * d_lat;
            let mut lon = u_row.lon_first + (i as f64) * d_lon;
            if lon > 180.0 {
                lon -= 360.0;
            }

            let speed_ms = (u * u + v * v).sqrt();
            let speed_kt = (speed_ms * 1.94384) as f32;
            let dir = ((270.0 - v.atan2(u).to_degrees()).rem_euclid(360.0)) as f32;

            // Convert pressure (Pa) to flight level
            // FL = (1 - (P/101325)^0.190284) * 145366.45 / 100
            let fl = ((1.0 - (pres_pa / 101325.0).powf(0.190284)) * 145366.45 / 100.0) as f32;

            lats.push(lat as f32);
            lons.push(lon as f32);
            speeds.push(speed_kt);
            directions.push(dir);
            flight_levels.push(fl);
        }
    }

    Ok(Json(MaxWindResponse {
        run_time,
        forecast_hour: params.forecast_hour,
        valid_time: u_row.valid_time,
        count: lats.len(),
        lats,
        lons,
        speeds,
        directions,
        flight_levels,
    }))
}

fn bytes_to_f32(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect()
}
```

- [ ] **Step 2: Register the route in main.rs**

Add `mod maxwind;` at the top of `main.rs` and add the route:

```rust
mod gridded;
mod maxwind;
mod meta;
mod opmet;
mod wind;
```

In the router builder, add:

```rust
.route("/api/maxwind", get(maxwind::get_maxwind))
```

- [ ] **Step 3: Build**

Run: `cd services && cargo build -p backend`
Expected: Compiles without errors.

- [ ] **Step 4: Commit**

```bash
git add services/backend/src/maxwind.rs services/backend/src/main.rs
git commit -m "feat(backend): add /api/maxwind endpoint for jet stream data"
```

---

## Task 5: Frontend — Contour Worker Update

**Files:**
- Modify: `services/frontend/src/utils/contourWorker.ts:8,24`

- [ ] **Step 1: Extend type union to include tropopause and maxwind**

In `contourWorker.ts`, update the `type` field in both `ContourRequest` and `ContourResult`:

```typescript
export interface ContourRequest {
  id: number;
  type: 'temperature' | 'height' | 'humidity' | 'tropopause' | 'maxwind';
  // ... rest unchanged
}

export interface ContourResult {
  id: number;
  type: 'temperature' | 'height' | 'humidity' | 'tropopause' | 'maxwind';
  // ... rest unchanged
}
```

- [ ] **Step 2: Verify build**

Run: `cd services/frontend && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add services/frontend/src/utils/contourWorker.ts
git commit -m "feat(frontend): extend contour worker types for tropopause and maxwind"
```

---

## Task 6: Frontend — Green Jet Wind Barb Atlas

**Files:**
- Modify: `services/frontend/src/utils/windBarbAtlas.ts`

- [ ] **Step 1: Add `getJetWindBarbAtlas()` function**

Add this function to `windBarbAtlas.ts`, after the existing `getStationWindBarbAtlas()`:

```typescript
let cachedJetResult: { atlas: string; mapping: WindBarbMapping } | null = null;

/**
 * Generate a dark green wind barb atlas for jet stream / max wind plots.
 */
export async function getJetWindBarbAtlas(): Promise<{
  atlas: string;
  mapping: WindBarbMapping;
}> {
  if (cachedJetResult) return cachedJetResult;

  const speeds = [0, ...Array.from({ length: 40 }, (_, i) => (i + 1) * 5)];
  const ROWS = Math.ceil(speeds.length / COLS);

  const canvas = document.createElement('canvas');
  canvas.width = COLS * ICON_SIZE;
  canvas.height = ROWS * ICON_SIZE;
  const ctx = canvas.getContext('2d')!;

  for (let index = 0; index < speeds.length; index++) {
    const svg = generateWindBarbSVG(speeds[index], false, '#1a6b3a', 2.5);
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = url;
      });
      const col = index % COLS;
      const row = Math.floor(index / COLS);
      ctx.drawImage(img, col * ICON_SIZE, row * ICON_SIZE, ICON_SIZE, ICON_SIZE);
    } catch {
      // skip
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  cachedJetResult = {
    atlas: canvas.toDataURL('image/png'),
    mapping: generateWindBarbMapping(),
  };

  return cachedJetResult;
}
```

- [ ] **Step 2: Verify build**

Run: `cd services/frontend && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add services/frontend/src/utils/windBarbAtlas.ts
git commit -m "feat(frontend): add dark green wind barb atlas for jet stream display"
```

---

## Task 7: Frontend — Tropopause + Max Wind Contour Layers

**Files:**
- Modify: `services/frontend/src/components/map/ContourLayer.ts`

- [ ] **Step 0: Install @deck.gl/extensions**

The `PathStyleExtension` lives in `@deck.gl/extensions`, which is not yet in `package.json`:

```bash
cd services/frontend && npm install @deck.gl/extensions
```

- [ ] **Step 1: Add PathStyleExtension import**

Add at the top of `ContourLayer.ts`:

```typescript
import { PathStyleExtension } from '@deck.gl/extensions';
```

- [ ] **Step 2: Add `createTropopauseLayers()` function**

Add after the existing `createHeightLayers()` function:

```typescript
/**
 * Create tropopause height contour layers — thin dotted light blue lines labeled with FL.
 */
export function createTropopauseLayers(contours: ComputedContours): Layer[] {
  const { lines, labels } = contours;
  if (lines.length === 0) return [];

  return [
    new PathLayer<ContourLine>({
      id: 'tropopause-contours',
      data: lines,
      getPath: (d) => d.coordinates,
      getColor: [100, 180, 240, 200],
      getWidth: 1.5,
      widthUnits: 'pixels',
      widthMinPixels: 1,
      getDashArray: [4, 3],
      extensions: [new PathStyleExtension({ dash: true })],
      pickable: false,
    }),
    new TextLayer<ContourLabel>({
      id: 'tropopause-labels',
      data: labels,
      getPosition: (d) => d.position,
      getText: (d) => d.text,
      getSize: 12,
      getColor: [70, 150, 220, 255],
      getTextAnchor: 'middle',
      getAlignmentBaseline: 'center',
      fontFamily: 'monospace',
      fontWeight: 'bold',
      sizeUnits: 'pixels',
      pickable: false,
    }),
  ];
}
```

- [ ] **Step 3: Add `createMaxWindIsotachLayers()` function**

Add after `createTropopauseLayers()`:

```typescript
/**
 * Create max wind isotach contour layers — dark green lines at 20kt intervals.
 * Lines at 80kt+ are thicker to highlight jet cores.
 */
export function createMaxWindIsotachLayers(contours: ComputedContours): Layer[] {
  const { lines, labels } = contours;
  if (lines.length === 0) return [];

  // Split lines into normal (<80kt) and strong (>=80kt)
  const normalLines = lines.filter((l) => l.value < 80);
  const strongLines = lines.filter((l) => l.value >= 80);

  const layers: Layer[] = [];

  if (normalLines.length > 0) {
    layers.push(
      new PathLayer<ContourLine>({
        id: 'maxwind-isotach-normal',
        data: normalLines,
        getPath: (d) => d.coordinates,
        getColor: [20, 120, 60, 160],
        getWidth: 1.5,
        widthUnits: 'pixels',
        widthMinPixels: 1,
        pickable: false,
      }),
    );
  }

  if (strongLines.length > 0) {
    layers.push(
      new PathLayer<ContourLine>({
        id: 'maxwind-isotach-strong',
        data: strongLines,
        getPath: (d) => d.coordinates,
        getColor: [15, 100, 50, 200],
        getWidth: 2.5,
        widthUnits: 'pixels',
        widthMinPixels: 2,
        pickable: false,
      }),
    );
  }

  if (labels.length > 0) {
    layers.push(
      new TextLayer<ContourLabel>({
        id: 'maxwind-isotach-labels',
        data: labels,
        getPosition: (d) => d.position,
        getText: (d) => d.text,
        getSize: 12,
        getColor: [15, 100, 50, 255],
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'center',
        fontFamily: 'monospace',
        fontWeight: 'bold',
        sizeUnits: 'pixels',
        pickable: false,
      }),
    );
  }

  return layers;
}
```

Note: The `ContourLine` type must have a `value` field. Check the existing `ContourLine` type in `contourComputation.ts` — it should already have this (it's the iso-value of the contour). If not, we'll add it.

- [ ] **Step 4: Verify build**

Run: `cd services/frontend && npx tsc --noEmit`
Expected: No type errors. If `PathStyleExtension` is not found, install: `npm install @deck.gl/extensions` (check if already in package.json first).

- [ ] **Step 5: Commit**

```bash
git add services/frontend/src/components/map/ContourLayer.ts
git commit -m "feat(frontend): add tropopause and max wind isotach contour layer factories"
```

---

## Task 8: Frontend — Store State for Tropopause + Max Wind

**Files:**
- Modify: `services/frontend/src/stores/appStore.ts`

This is the largest frontend change. Add state, toggles, fetch methods, and cache invalidation for both layers.

- [ ] **Step 1: Add tropopause and maxWind state to AppState interface**

After the humidity section (line 95) in the `AppState` interface, add:

```typescript
  // Tropopause (pre-computed contours)
  tropopauseContours: ComputedContours | null;
  tropopauseVisible: boolean;
  tropopauseLoading: boolean;
  tropopauseError: string | null;
  tropopauseTempData: { lats: number[]; lons: number[]; values: number[]; ni: number; nj: number } | null;
  toggleTropopause: () => void;
  fetchTropopauseData: () => Promise<void>;

  // Max Wind / Jet Stream
  maxWindVisible: boolean;
  maxWindLoading: boolean;
  maxWindError: string | null;
  maxWindContours: ComputedContours | null;
  maxWindBarbs: { lat: number; lon: number; speed: number; direction: number; fl: number }[];
  toggleMaxWind: () => void;
  fetchMaxWindData: () => Promise<void>;
```

- [ ] **Step 2: Add initial state values**

After the humidity initial state (line 224), add:

```typescript
  tropopauseContours: null,
  tropopauseVisible: false,
  tropopauseLoading: false,
  tropopauseError: null,
  tropopauseTempData: null,

  maxWindVisible: false,
  maxWindLoading: false,
  maxWindError: null,
  maxWindContours: null,
  maxWindBarbs: [],
```

- [ ] **Step 3: Add toggle and fetch methods for tropopause**

Add after the `toggleHumidity` method:

```typescript
  toggleTropopause: () => {
    const wasVisible = get().tropopauseVisible;
    set({ tropopauseVisible: !wasVisible });
    if (!wasVisible && !get().tropopauseContours) {
      get().fetchTropopauseData();
    }
  },

  fetchTropopauseData: async () => {
    const { selectedRunTime, selectedForecastHour } = get();
    set({ tropopauseLoading: true, tropopauseError: null });
    try {
      // Fetch tropopause pressure for contours
      const params = new URLSearchParams({
        parameter: 'PRES',
        level_hpa: '-1',
        level_type: 'tropopause',
        forecast_hour: String(selectedForecastHour),
        thin: '2',
      });
      if (selectedRunTime) params.set('run_time', selectedRunTime);

      const res = await fetch(`/api/gridded?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: GriddedData = await res.json();

      // Convert pressure (Pa) to flight level for contouring
      const flValues = data.values.map((p: number) => {
        const fl = (1 - Math.pow(p / 101325, 0.190284)) * 145366.45 / 100;
        return Math.round(fl / 10) * 10; // Round to nearest 10 FL
      });

      const contours = await computeContoursAsync({
        type: 'tropopause',
        ni: data.ni,
        nj: data.nj,
        lats: data.lats,
        lons: data.lons,
        values: flValues,
        interval: 20,
        upsampleFactor: 4,
        labelSuffix: '',
        influenceRadius: 30,
        minSeparationDeg: 25,
      });

      // Also fetch tropopause temperature for tooltips
      const tempParams = new URLSearchParams({
        parameter: 'TMP',
        level_hpa: '-1',
        level_type: 'tropopause',
        forecast_hour: String(selectedForecastHour),
        thin: '2',
      });
      if (selectedRunTime) tempParams.set('run_time', selectedRunTime);

      let tempData = null;
      try {
        const tempRes = await fetch(`/api/gridded?${tempParams}`);
        if (tempRes.ok) {
          const td: GriddedData = await tempRes.json();
          tempData = {
            lats: td.lats,
            lons: td.lons,
            values: td.values.map((k: number) => k - 273.15), // K → °C
            ni: td.ni,
            nj: td.nj,
          };
        }
      } catch {
        // Temperature tooltip is optional — don't fail if unavailable
      }

      set({
        tropopauseContours: { lines: contours.lines, labels: contours.labels },
        tropopauseTempData: tempData,
        tropopauseLoading: false,
      });
    } catch (err) {
      set({
        tropopauseError: err instanceof Error ? err.message : 'Unknown error',
        tropopauseLoading: false,
      });
    }
  },
```

- [ ] **Step 4: Add toggle and fetch methods for max wind**

Add after the tropopause methods:

```typescript
  toggleMaxWind: () => {
    const wasVisible = get().maxWindVisible;
    set({ maxWindVisible: !wasVisible });
    if (!wasVisible && !get().maxWindContours) {
      get().fetchMaxWindData();
    }
  },

  fetchMaxWindData: async () => {
    const { selectedRunTime, selectedForecastHour } = get();
    set({ maxWindLoading: true, maxWindError: null });
    try {
      // Fetch max wind data from dedicated endpoint
      const params = new URLSearchParams({
        forecast_hour: String(selectedForecastHour),
        thin: '2',
      });
      if (selectedRunTime) params.set('run_time', selectedRunTime);

      const res = await fetch(`/api/maxwind?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      // Build wind speed grid for isotach contouring
      // The /api/maxwind returns flat arrays; we need to reshape for the contour worker
      const speeds: number[] = data.speeds;

      // Compute unique sorted lats and lons to determine grid dimensions
      const uniqueLats = [...new Set(data.lats as number[])].sort((a, b) => b - a);
      const uniqueLons = [...new Set(data.lons as number[])].sort((a, b) => a - b);
      const ni = uniqueLons.length;
      const nj = uniqueLats.length;

      // Build a 2D grid of speeds (row-major: nj rows of ni columns)
      const gridSpeeds = new Array(nj * ni).fill(0);
      for (let k = 0; k < data.count; k++) {
        const jIdx = uniqueLats.indexOf(data.lats[k]);
        const iIdx = uniqueLons.indexOf(data.lons[k]);
        if (jIdx >= 0 && iIdx >= 0) {
          gridSpeeds[jIdx * ni + iIdx] = speeds[k];
        }
      }

      const contours = await computeContoursAsync({
        type: 'maxwind',
        ni,
        nj,
        lats: uniqueLats,
        lons: uniqueLons,
        values: gridSpeeds,
        interval: 20,
        upsampleFactor: 4,
        labelSuffix: 'kt',
        influenceRadius: 30,
        minSeparationDeg: 25,
      });

      // Build wind barb data for points >= 60kt
      const barbs: { lat: number; lon: number; speed: number; direction: number; fl: number }[] = [];
      for (let k = 0; k < data.count; k++) {
        if (data.speeds[k] >= 60) {
          barbs.push({
            lat: data.lats[k],
            lon: data.lons[k],
            speed: data.speeds[k],
            direction: data.directions[k],
            fl: data.flight_levels[k],
          });
        }
      }

      set({
        maxWindContours: { lines: contours.lines, labels: contours.labels },
        maxWindBarbs: barbs,
        maxWindLoading: false,
      });
    } catch (err) {
      set({
        maxWindError: err instanceof Error ? err.message : 'Unknown error',
        maxWindLoading: false,
      });
    }
  },
```

- [ ] **Step 5: Update cache invalidation in setRunTime, setForecastHour, setLevel**

In the `setRunTime` method (around line 400), update the cache-clearing line:

```typescript
    set({ temperatureContours: null, heightContours: null, humidityContours: null, tropopauseContours: null, tropopauseTempData: null, maxWindContours: null, maxWindBarbs: [] });
```

And add refetch calls:

```typescript
    if (get().tropopauseVisible) get().fetchTropopauseData();
    if (get().maxWindVisible) get().fetchMaxWindData();
```

Apply the same pattern in `setForecastHour` and `setLevel`.

**Important note for `setLevel`:** Tropopause and max wind are level-independent (they use fixed surfaces, not isobaric levels), so they do NOT need to be refetched when the level changes — only clear and refetch is needed for run time and forecast hour changes. However, clearing the cache on level change is still safe (just unnecessary). For simplicity, apply the same pattern everywhere.

- [ ] **Step 6: Verify build**

Run: `cd services/frontend && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 7: Commit**

```bash
git add services/frontend/src/stores/appStore.ts
git commit -m "feat(frontend): add tropopause and max wind store state, toggles, and fetch methods"
```

---

## Task 9: Frontend — Toolbar Toggle Buttons

**Files:**
- Modify: `services/frontend/src/components/Toolbar.tsx:28-51,127-134`

- [ ] **Step 1: Add store selectors for new layers**

In `Toolbar.tsx`, add these selectors after the existing station selectors (around line 50):

```typescript
  const tropopauseVisible = useAppStore((s) => s.tropopauseVisible);
  const tropopauseLoading = useAppStore((s) => s.tropopauseLoading);
  const toggleTropopause = useAppStore((s) => s.toggleTropopause);
  const maxWindVisible = useAppStore((s) => s.maxWindVisible);
  const maxWindLoading = useAppStore((s) => s.maxWindLoading);
  const toggleMaxWind = useAppStore((s) => s.toggleMaxWind);
```

- [ ] **Step 2: Add toggle buttons to JSX**

After the Stations button (line 134) and before the GoToLocation component, add:

```tsx
      <button
        className={tropopauseVisible ? 'toggle-btn active' : 'toggle-btn'}
        onClick={toggleTropopause}
      >
        Trop {tropopauseLoading ? '...' : tropopauseVisible ? 'ON' : 'OFF'}
      </button>

      <button
        className={maxWindVisible ? 'toggle-btn active' : 'toggle-btn'}
        onClick={toggleMaxWind}
      >
        Jet {maxWindLoading ? '...' : maxWindVisible ? 'ON' : 'OFF'}
      </button>
```

- [ ] **Step 3: Verify build**

Run: `cd services/frontend && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add services/frontend/src/components/Toolbar.tsx
git commit -m "feat(frontend): add Trop and Jet toggle buttons to toolbar"
```

---

## Task 10: Frontend — Wire Layers into MapView

**Files:**
- Modify: `services/frontend/src/components/map/MapView.tsx`

- [ ] **Step 1: Add imports**

Update imports at top of `MapView.tsx`:

```typescript
import { createTemperatureLayers, createHeightLayers, createHumidityLayers, createTropopauseLayers, createMaxWindIsotachLayers } from './ContourLayer';
```

Add import for the jet barb atlas:

```typescript
import { getWindBarbAtlas, getStationWindBarbAtlas, getJetWindBarbAtlas } from '../../utils/windBarbAtlas';
```

Add import for `getWindBarbKey`:

```typescript
import { getWindBarbKey, generateWindBarbMapping } from '../../utils/windBarbs';
```

(This import already exists — just verify it's there.)

- [ ] **Step 2: Add store selectors**

Add these selectors alongside the existing ones (around line 46-54):

```typescript
  const tropopauseContours = useAppStore((s) => s.tropopauseContours);
  const tropopauseVisible = useAppStore((s) => s.tropopauseVisible);
  const maxWindContours = useAppStore((s) => s.maxWindContours);
  const maxWindVisible = useAppStore((s) => s.maxWindVisible);
  const maxWindBarbs = useAppStore((s) => s.maxWindBarbs);
```

- [ ] **Step 3: Add jet barb atlas state and loading**

Add state for the jet atlas (near the other atlas state, around line 23):

```typescript
  const [jetBarbAtlasUrl, setJetBarbAtlasUrl] = useState<string | null>(null);
```

In the atlas loading useEffect (around line 72-82), add:

```typescript
    getJetWindBarbAtlas().then(({ atlas }) => setJetBarbAtlasUrl(atlas));
```

- [ ] **Step 4: Add tropopause and max wind layers to the layer composition**

In the `useEffect` that builds layers (around line 178), add tropopause layers after height contours:

```typescript
    // Tropopause contours (dotted blue lines)
    if (tropopauseVisible && tropopauseContours) {
      layers.push(...createTropopauseLayers(tropopauseContours));
    }
```

Add max wind layers before the wind barbs section:

```typescript
    // Max wind isotach contours (green lines)
    if (maxWindVisible && maxWindContours) {
      layers.push(...createMaxWindIsotachLayers(maxWindContours));
    }

    // Max wind barbs (green, >= 60kt)
    if (maxWindVisible && maxWindBarbs.length > 0 && jetBarbAtlasUrl) {
      const jetStride = windBarbStride(mapZoom);
      const filteredJetBarbs = jetStride === 1
        ? maxWindBarbs
        : maxWindBarbs.filter((_, i) => i % jetStride === 0);

      layers.push(new IconLayer({
        id: 'maxwind-barbs',
        data: filteredJetBarbs,
        getPosition: (d) => [d.lon, d.lat],
        getIcon: (d) => getWindBarbKey(d.speed),
        getAngle: (d) => d.direction,
        getSize: 40,
        iconAtlas: jetBarbAtlasUrl,
        iconMapping: iconMapping as Record<string, { x: number; y: number; width: number; height: number }>,
        sizeUnits: 'pixels',
        sizeMinPixels: 20,
        sizeMaxPixels: 50,
        pickable: false,
      }));
    }
```

- [ ] **Step 5: Update the useEffect dependency array**

Add the new state variables to the dependency array of the layer-building useEffect (line 245):

Add: `tropopauseContours, tropopauseVisible, maxWindContours, maxWindVisible, maxWindBarbs, jetBarbAtlasUrl`

- [ ] **Step 6: Verify build**

Run: `cd services/frontend && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 7: Commit**

```bash
git add services/frontend/src/components/map/MapView.tsx
git commit -m "feat(frontend): wire tropopause and max wind layers into MapView"
```

---

## Task 11: Verify ContourLine Has `value` Field

**Files:**
- Check: `services/frontend/src/utils/contourComputation.ts`

- [ ] **Step 1: Verify tropopause label format**

The tropopause contour labels need to show "FL300" format, not "300" with a suffix. The current `fetchTropopauseData` in the store uses `labelSuffix: ''` which would produce labels like "300". Update the `formatLabel` function or suffix.

Check if the contour worker's `formatLabel` uses `${v}${suffix}`. If so, the labels will be "300", "320", etc. We want "FL300", "FL320". Options:
- Change `labelSuffix` to be a prefix: not supported by the worker
- Use a custom `formatLabel` callback: only if the worker supports it
- Post-process labels after contouring: simplest

The simplest approach: set `labelSuffix: ''` and then post-process the contour labels in the store to prepend "FL". Add this after the `computeContoursAsync` call:

```typescript
      // Prepend "FL" to tropopause contour labels
      contours.labels = contours.labels.map(l => ({
        ...l,
        text: `FL${l.text}`,
      }));
```

- [ ] **Step 2: Commit if changes were needed**

```bash
git add services/frontend/src/stores/appStore.ts
git commit -m "fix(frontend): add FL prefix to tropopause contour labels"
```

---

## Task 12: Integration Test — Docker Compose

- [ ] **Step 1: Build and run the full stack**

```bash
docker compose build
docker compose up -d
```

Wait for services to boot and acquisition to download data (check logs):

```bash
docker compose logs -f acquisition decoder
```

- [ ] **Step 2: Verify tropopause data in database**

```bash
docker compose exec postgres psql -U cirrus -c "SELECT DISTINCT parameter, level_type, level_hpa FROM gridded_fields WHERE level_type IN ('tropopause', 'maxwind') ORDER BY level_type, parameter;"
```

Expected: Rows for PRES and TMP at tropopause, and UGRD, VGRD, PRES, HGT, TMP at maxwind.

- [ ] **Step 3: Test API endpoints**

```bash
# Tropopause pressure
curl -s 'http://localhost:8080/api/gridded?parameter=PRES&level_hpa=-1&level_type=tropopause&forecast_hour=6&thin=8' | jq '.parameter, .ni, .nj'

# Max wind
curl -s 'http://localhost:8080/api/maxwind?forecast_hour=6&thin=8' | jq '.count'
```

Expected: Both return data.

- [ ] **Step 4: Visual test in browser**

Open `http://localhost:3000` (or whatever port the frontend runs on). Toggle "Trop" — should see dotted blue contour lines labeled with FL. Toggle "Jet" — should see green isotach contours with green wind barbs at jet stream cores.

- [ ] **Step 5: Commit any fixes needed**

---

## Label Format Reference

The tropopause contour labels prepend "FL" before the flight level number. Example labels: "FL280", "FL300", "FL340", "FL400".

The max wind isotach labels append "kt" after the speed value. Example labels: "60kt", "80kt", "100kt", "120kt".
