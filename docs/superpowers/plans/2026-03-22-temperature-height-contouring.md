# Temperature & Height Contouring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add temperature isotherms (red, 5°C) and geopotential height contours (blue, level-adaptive) with H/L extrema labels to the map, served by a generic `/api/gridded` backend endpoint.

**Architecture:** Rust backend serves raw gridded data as JSON (1D axis arrays + flat values). Frontend computes contours client-side using D3 marching squares with bilinear upsampling (ported from cirrus-old), renders via Deck.gl PathLayer + TextLayer. H/L centers detected by scanning for local extrema with proximity deduplication.

**Tech Stack:** Rust (Axum, sqlx), React, TypeScript, D3-contour, Deck.gl PathLayer/TextLayer, Zustand.

**Spec:** `docs/superpowers/specs/2026-03-22-temperature-height-contouring-design.md`

**Reference code:** `/Users/greg/Development/cirrus-old/frontend/src/utils/contourComputation.ts` and `/Users/greg/Development/cirrus-old/frontend/src/components/map/ContourLayer.ts`

---

## File Map

### Backend
| File | Responsibility |
|---|---|
| `services/backend/src/gridded.rs` | `/api/gridded` handler: fetch any parameter, thin, return JSON |
| `services/backend/src/main.rs` | Add route + module declaration |

### Frontend
| File | Responsibility |
|---|---|
| `services/frontend/src/utils/contourComputation.ts` | D3 marching squares + bilinear upsampling (ported from cirrus-old) |
| `services/frontend/src/utils/extremaDetection.ts` | H/L center detection with proximity deduplication |
| `services/frontend/src/components/map/ContourLayer.ts` | Deck.gl PathLayer + TextLayer factories for temp/height/extrema |
| `services/frontend/src/stores/appStore.ts` | Add GriddedData type, temp/height state, toggles, fetches |
| `services/frontend/src/components/Toolbar.tsx` | Add Temp/Height toggle buttons |
| `services/frontend/src/components/map/MapView.tsx` | Add contour layers to Deck.gl overlay |

---

## Task 1: Backend — `/api/gridded` Endpoint

**Files:**
- Create: `services/backend/src/gridded.rs`
- Modify: `services/backend/src/main.rs`

- [ ] **Step 1: Create gridded.rs**

Create `services/backend/src/gridded.rs`. This is structurally similar to `wind.rs` but serves a single parameter's raw grid data with 1D axis arrays.

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
pub struct GriddedQuery {
    parameter: String,
    level_hpa: i32,
    forecast_hour: i32,
    run_time: Option<DateTime<Utc>>,
    thin: Option<usize>,
}

#[derive(Serialize)]
pub struct GriddedResponse {
    parameter: String,
    run_time: DateTime<Utc>,
    forecast_hour: i32,
    valid_time: DateTime<Utc>,
    level_hpa: i32,
    ni: usize,
    nj: usize,
    lats: Vec<f32>,
    lons: Vec<f32>,
    values: Vec<f32>,
}

#[derive(sqlx::FromRow)]
struct GridRow {
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

pub async fn get_gridded(
    State(pool): State<PgPool>,
    Query(params): Query<GriddedQuery>,
) -> Result<Json<GriddedResponse>, StatusCode> {
    let thin = params.thin.unwrap_or(2).max(1);

    // Resolve run_time
    let run_time = match params.run_time {
        Some(rt) => rt,
        None => {
            sqlx::query_scalar::<_, DateTime<Utc>>(
                "SELECT run_time FROM gridded_fields ORDER BY run_time DESC LIMIT 1"
            )
            .fetch_optional(&pool)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
            .ok_or(StatusCode::NOT_FOUND)?
        }
    };

    // Fetch the gridded field
    let row = sqlx::query_as::<_, GridRow>(
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
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .ok_or(StatusCode::NOT_FOUND)?;

    let raw_ni = row.ni as usize;
    let raw_nj = row.nj as usize;

    // Decode BYTEA to f32 array
    let all_values: Vec<f32> = row.values
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect();

    // Compute effective d_lat (negate for N→S grids)
    let d_lat = if row.lat_first > row.lat_last {
        -row.d_lat.abs()
    } else {
        row.d_lat.abs()
    };

    // Build thinned 1D axis arrays and values
    let mut lats = Vec::new();
    let mut lons = Vec::new();
    let mut values = Vec::new();

    // Compute thinned lat array
    let mut j_indices = Vec::new();
    let mut j = 0usize;
    while j < raw_nj {
        lats.push((row.lat_first + (j as f64) * d_lat) as f32);
        j_indices.push(j);
        j += thin;
    }

    // Compute thinned lon array
    let mut i_indices = Vec::new();
    let mut i = 0usize;
    while i < raw_ni {
        let mut lon = row.lon_first + (i as f64) * row.d_lon;
        if lon > 180.0 { lon -= 360.0; }
        lons.push(lon as f32);
        i_indices.push(i);
        i += thin;
    }

    let out_ni = i_indices.len();
    let out_nj = j_indices.len();

    // Extract thinned values in row-major order (j outer, i inner)
    for &jj in &j_indices {
        for &ii in &i_indices {
            let idx = jj * raw_ni + ii;
            if idx < all_values.len() {
                values.push(all_values[idx]);
            }
        }
    }

    Ok(Json(GriddedResponse {
        parameter: params.parameter,
        run_time,
        forecast_hour: params.forecast_hour,
        valid_time: row.valid_time,
        level_hpa: params.level_hpa,
        ni: out_ni,
        nj: out_nj,
        lats,
        lons,
        values,
    }))
}
```

- [ ] **Step 2: Add route to main.rs**

Add `mod gridded;` to the top of `services/backend/src/main.rs` and add the route:

```rust
mod gridded;
```

Add to the router:
```rust
.route("/api/gridded", get(gridded::get_gridded))
```

- [ ] **Step 3: Verify compiles**

```bash
cd /Users/greg/Development/cirrus/services
cargo check -p backend
```

- [ ] **Step 4: Commit**

```bash
cd /Users/greg/Development/cirrus
git add services/backend/src/gridded.rs services/backend/src/main.rs
git commit -m "feat(backend): generic /api/gridded endpoint for any parameter"
```

---

## Task 2: Frontend — Install D3 and Port Contour Computation

**Files:**
- Create: `services/frontend/src/utils/contourComputation.ts`

- [ ] **Step 1: Install d3-contour**

```bash
cd /Users/greg/Development/cirrus/services/frontend
npm install d3-contour
npm install -D @types/d3-contour
```

- [ ] **Step 2: Port contourComputation.ts from cirrus-old**

Copy `/Users/greg/Development/cirrus-old/frontend/src/utils/contourComputation.ts` to `services/frontend/src/utils/contourComputation.ts`. Use the file exactly as-is — it contains `computeContourLines()` with bilinear upsampling, D3 marching squares, boundary splitting, lon-wrap handling, and label subsampling.

- [ ] **Step 3: Commit**

```bash
cd /Users/greg/Development/cirrus
git add services/frontend/package.json services/frontend/package-lock.json services/frontend/src/utils/contourComputation.ts
git commit -m "feat(frontend): port contour computation from cirrus-old with d3-contour"
```

---

## Task 3: Frontend — Extrema Detection

**Files:**
- Create: `services/frontend/src/utils/extremaDetection.ts`

- [ ] **Step 1: Create extremaDetection.ts**

Create `services/frontend/src/utils/extremaDetection.ts`:

```typescript
/**
 * Detect local maxima (H) and minima (L) in a gridded field.
 * Used for labeling geopotential height centers on the map.
 */

export interface Extremum {
  position: [number, number]; // [lon, lat]
  value: number;
}

/**
 * Find high and low pressure centers in a 2D grid.
 *
 * Algorithm:
 * 1. For each grid point (skipping edges), check if it's the max or min
 *    within a square neighborhood of `influenceRadius` grid points.
 * 2. Deduplicate: sort candidates by strength and suppress any within
 *    `minSeparationDeg` degrees of a stronger candidate of the same type.
 */
export function findExtrema(
  ni: number,
  nj: number,
  lats: number[],
  lons: number[],
  values: number[],
  influenceRadius: number = 10,
  minSeparationDeg: number = 15,
): { highs: Extremum[]; lows: Extremum[] } {
  const margin = 2;
  const candidateHighs: Extremum[] = [];
  const candidateLows: Extremum[] = [];

  for (let j = margin; j < nj - margin; j++) {
    for (let i = margin; i < ni - margin; i++) {
      const val = values[j * ni + i];
      let isMax = true;
      let isMin = true;

      // Check neighborhood
      const jMin = Math.max(0, j - influenceRadius);
      const jMax = Math.min(nj - 1, j + influenceRadius);
      const iMin = Math.max(0, i - influenceRadius);
      const iMax = Math.min(ni - 1, i + influenceRadius);

      for (let jj = jMin; jj <= jMax && (isMax || isMin); jj++) {
        for (let ii = iMin; ii <= iMax && (isMax || isMin); ii++) {
          if (jj === j && ii === i) continue;
          const neighbor = values[jj * ni + ii];
          if (neighbor >= val) isMax = false;
          if (neighbor <= val) isMin = false;
        }
      }

      if (isMax) {
        candidateHighs.push({ position: [lons[i], lats[j]], value: val });
      }
      if (isMin) {
        candidateLows.push({ position: [lons[i], lats[j]], value: val });
      }
    }
  }

  // Deduplicate: keep strongest, suppress nearby weaker candidates
  const highs = deduplicateExtrema(candidateHighs, minSeparationDeg, 'high');
  const lows = deduplicateExtrema(candidateLows, minSeparationDeg, 'low');

  return { highs, lows };
}

function deduplicateExtrema(
  candidates: Extremum[],
  minSeparationDeg: number,
  type: 'high' | 'low',
): Extremum[] {
  // Sort by strength: highest first for highs, lowest first for lows
  const sorted = [...candidates].sort((a, b) =>
    type === 'high' ? b.value - a.value : a.value - b.value
  );

  const kept: Extremum[] = [];
  for (const candidate of sorted) {
    const tooClose = kept.some(
      (k) =>
        Math.abs(candidate.position[0] - k.position[0]) < minSeparationDeg &&
        Math.abs(candidate.position[1] - k.position[1]) < minSeparationDeg
    );
    if (!tooClose) {
      kept.push(candidate);
    }
  }

  return kept;
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/greg/Development/cirrus
git add services/frontend/src/utils/extremaDetection.ts
git commit -m "feat(frontend): H/L extrema detection with proximity deduplication"
```

---

## Task 4: Frontend — Contour Layer Factories

**Files:**
- Create: `services/frontend/src/components/map/ContourLayer.ts`

- [ ] **Step 1: Create ContourLayer.ts**

Create `services/frontend/src/components/map/ContourLayer.ts`. Port and adapt from cirrus-old's `ContourLayer.ts`:

```typescript
import { PathLayer, TextLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import { computeContourLines } from '../../utils/contourComputation';
import type { ContourLine, ContourLabel } from '../../utils/contourComputation';
import { findExtrema } from '../../utils/extremaDetection';
import type { Extremum } from '../../utils/extremaDetection';

export interface GriddedData {
  parameter: string;
  run_time: string;
  forecast_hour: number;
  valid_time: string;
  level_hpa: number;
  ni: number;
  nj: number;
  lats: number[];
  lons: number[];
  values: number[];
}

function kelvinToCelsius(k: number): number {
  return k - 273.15;
}

/**
 * Create temperature isotherm layers.
 * Converts K→°C, 5°C intervals, red lines and labels.
 */
export function createTemperatureLayers(data: GriddedData): Layer[] {
  const { lines, labels } = computeContourLines(
    data.ni, data.nj, data.lats, data.lons, data.values,
    {
      convertValue: kelvinToCelsius,
      formatLabel: (v) => `${v}°C`,
      interval: 5,
      upsampleFactor: 4,
      splitOnLonWrap: true,
    },
  );

  if (lines.length === 0) return [];

  return [
    new PathLayer<ContourLine>({
      id: 'temperature-contours',
      data: lines,
      getPath: (d) => d.coordinates,
      getColor: [220, 60, 60, 180],
      getWidth: 1.5,
      widthUnits: 'pixels',
      widthMinPixels: 1,
      pickable: false,
    }),
    new TextLayer<ContourLabel>({
      id: 'temperature-labels',
      data: labels,
      getPosition: (d) => d.position,
      getText: (d) => d.text,
      getSize: 13,
      getColor: [180, 40, 40, 220],
      getTextAnchor: 'middle',
      getAlignmentBaseline: 'center',
      fontFamily: 'monospace',
      fontWeight: 'bold',
      background: true,
      getBackgroundColor: [255, 255, 255, 200],
      backgroundPadding: [3, 2, 3, 2],
      sizeUnits: 'pixels',
      pickable: false,
    }),
  ];
}

/**
 * Create geopotential height contour layers with H/L extrema labels.
 * Level-adaptive intervals: 60m above FL240 (< 400 hPa), 30m at/below FL240 (>= 400 hPa).
 */
export function createHeightLayers(data: GriddedData, levelHpa: number): Layer[] {
  const interval = levelHpa < 400 ? 60 : 30;

  const { lines, labels } = computeContourLines(
    data.ni, data.nj, data.lats, data.lons, data.values,
    {
      formatLabel: (v) => `${v}m`,
      interval,
      upsampleFactor: 4,
      splitOnLonWrap: true,
    },
  );

  const layers: Layer[] = [];

  if (lines.length > 0) {
    layers.push(
      new PathLayer<ContourLine>({
        id: 'height-contours',
        data: lines,
        getPath: (d) => d.coordinates,
        getColor: [40, 80, 200, 180],
        getWidth: 1.5,
        widthUnits: 'pixels',
        widthMinPixels: 1,
        pickable: false,
      }),
      new TextLayer<ContourLabel>({
        id: 'height-labels',
        data: labels,
        getPosition: (d) => d.position,
        getText: (d) => d.text,
        getSize: 13,
        getColor: [30, 60, 170, 220],
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'center',
        fontFamily: 'monospace',
        fontWeight: 'bold',
        background: true,
        getBackgroundColor: [255, 255, 255, 200],
        backgroundPadding: [3, 2, 3, 2],
        sizeUnits: 'pixels',
        pickable: false,
      }),
    );
  }

  // H/L extrema detection
  const { highs, lows } = findExtrema(
    data.ni, data.nj, data.lats, data.lons, data.values,
  );

  const extremaData = [
    ...highs.map((e) => ({ ...e, type: 'H' as const })),
    ...lows.map((e) => ({ ...e, type: 'L' as const })),
  ];

  if (extremaData.length > 0) {
    layers.push(
      new TextLayer<typeof extremaData[number]>({
        id: 'height-extrema',
        data: extremaData,
        getPosition: (d) => d.position,
        getText: (d) => `${d.type}\n${Math.round(d.value)}m`,
        getSize: 16,
        getColor: (d) => d.type === 'H' ? [220, 40, 40, 255] : [40, 40, 220, 255],
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'center',
        fontFamily: 'sans-serif',
        fontWeight: 'bold',
        background: true,
        getBackgroundColor: [255, 255, 255, 220],
        backgroundPadding: [4, 3, 4, 3],
        sizeUnits: 'pixels',
        pickable: false,
      }),
    );
  }

  return layers;
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/greg/Development/cirrus
git add services/frontend/src/components/map/ContourLayer.ts
git commit -m "feat(frontend): contour layer factories for temperature and height with H/L labels"
```

---

## Task 5: Frontend — Store, Toolbar, and MapView Updates

**Files:**
- Modify: `services/frontend/src/stores/appStore.ts`
- Modify: `services/frontend/src/components/Toolbar.tsx`
- Modify: `services/frontend/src/components/map/MapView.tsx`

- [ ] **Step 1: Update appStore.ts**

Add `GriddedData` export, temperature/height state, and fetch actions. Key additions to the store interface and implementation:

Add the `GriddedData` re-export **before** the `AppState` interface declaration (it must be in scope when the interface uses it):

```typescript
// Add this BEFORE the AppState interface:
export type { GriddedData } from '../components/map/ContourLayer';

// Add to AppState interface:
  // Temperature
  temperatureGrid: GriddedData | null;
  temperatureVisible: boolean;
  temperatureLoading: boolean;
  temperatureError: string | null;
  toggleTemperature: () => void;
  fetchTemperatureData: () => Promise<void>;

  // Height
  heightGrid: GriddedData | null;
  heightVisible: boolean;
  heightLoading: boolean;
  heightError: string | null;
  toggleHeight: () => void;
  fetchHeightData: () => Promise<void>;
```

Add to the store implementation:

```typescript
  temperatureGrid: null,
  temperatureVisible: false,
  temperatureLoading: false,
  temperatureError: null,

  heightGrid: null,
  heightVisible: false,
  heightLoading: false,
  heightError: null,

  toggleTemperature: () => {
    const wasVisible = get().temperatureVisible;
    set({ temperatureVisible: !wasVisible });
    if (!wasVisible && !get().temperatureGrid) {
      get().fetchTemperatureData();
    }
  },

  toggleHeight: () => {
    const wasVisible = get().heightVisible;
    set({ heightVisible: !wasVisible });
    if (!wasVisible && !get().heightGrid) {
      get().fetchHeightData();
    }
  },

  fetchTemperatureData: async () => {
    const { selectedRunTime, selectedForecastHour, selectedLevel } = get();
    set({ temperatureLoading: true, temperatureError: null });
    try {
      const params = new URLSearchParams({
        parameter: 'TMP',
        level_hpa: String(selectedLevel),
        forecast_hour: String(selectedForecastHour),
        thin: '2',
      });
      if (selectedRunTime) params.set('run_time', selectedRunTime);
      const res = await fetch(`/api/gridded?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      set({ temperatureGrid: data, temperatureLoading: false });
    } catch (err) {
      set({
        temperatureError: err instanceof Error ? err.message : 'Unknown error',
        temperatureLoading: false,
      });
    }
  },

  fetchHeightData: async () => {
    const { selectedRunTime, selectedForecastHour, selectedLevel } = get();
    set({ heightLoading: true, heightError: null });
    try {
      const params = new URLSearchParams({
        parameter: 'HGT',
        level_hpa: String(selectedLevel),
        forecast_hour: String(selectedForecastHour),
        thin: '2',
      });
      if (selectedRunTime) params.set('run_time', selectedRunTime);
      const res = await fetch(`/api/gridded?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      set({ heightGrid: data, heightLoading: false });
    } catch (err) {
      set({
        heightError: err instanceof Error ? err.message : 'Unknown error',
        heightLoading: false,
      });
    }
  },
```

Update `setRunTime`, `setForecastHour`, and `setLevel` to clear cached grids and refetch visible layers. Add to each setter after the existing `get().fetchWindData()` call:

```typescript
    // Clear cached grids
    set({ temperatureGrid: null, heightGrid: null });
    // Refetch visible layers
    if (get().temperatureVisible) get().fetchTemperatureData();
    if (get().heightVisible) get().fetchHeightData();
```

- [ ] **Step 2: Update Toolbar.tsx**

Add two toggle buttons after the Wind button. Add these store selectors at the top of the component:

```typescript
  const temperatureVisible = useAppStore((s) => s.temperatureVisible);
  const temperatureLoading = useAppStore((s) => s.temperatureLoading);
  const toggleTemperature = useAppStore((s) => s.toggleTemperature);
  const heightVisible = useAppStore((s) => s.heightVisible);
  const heightLoading = useAppStore((s) => s.heightLoading);
  const toggleHeight = useAppStore((s) => s.toggleHeight);
```

Add after the Wind button:

```tsx
      <button
        className={temperatureVisible ? 'toggle-btn active' : 'toggle-btn'}
        onClick={toggleTemperature}
      >
        Temp {temperatureLoading ? '...' : temperatureVisible ? 'ON' : 'OFF'}
      </button>

      <button
        className={heightVisible ? 'toggle-btn active' : 'toggle-btn'}
        onClick={toggleHeight}
      >
        Height {heightLoading ? '...' : heightVisible ? 'ON' : 'OFF'}
      </button>
```

- [ ] **Step 3: Update MapView.tsx**

Add imports at the top:

```typescript
import type { Layer } from '@deck.gl/core';
import { createTemperatureLayers, createHeightLayers } from './ContourLayer';
```

Add store selectors alongside the existing wind selectors:

```typescript
  const temperatureGrid = useAppStore((s) => s.temperatureGrid);
  const temperatureVisible = useAppStore((s) => s.temperatureVisible);
  const heightGrid = useAppStore((s) => s.heightGrid);
  const heightVisible = useAppStore((s) => s.heightVisible);
  const selectedLevel = useAppStore((s) => s.selectedLevel);
```

Update the layer type from `IconLayer[]` to `Layer[]` (import `Layer` from `@deck.gl/core`).

Add contour layers before the wind barb layer in the `useEffect` (rendering bottom to top):

```typescript
    // Height contours (bottom)
    if (heightVisible && heightGrid) {
      layers.push(...createHeightLayers(heightGrid, selectedLevel));
    }

    // Temperature contours (middle)
    if (temperatureVisible && temperatureGrid) {
      layers.push(...createTemperatureLayers(temperatureGrid));
    }

    // Wind barbs (top) — existing code
```

Add `temperatureGrid`, `temperatureVisible`, `heightGrid`, `heightVisible`, `selectedLevel` to the `useEffect` dependency array.

- [ ] **Step 4: Verify frontend builds**

```bash
cd /Users/greg/Development/cirrus/services/frontend
npm run build
```

- [ ] **Step 5: Commit**

```bash
cd /Users/greg/Development/cirrus
git add services/frontend/src/stores/appStore.ts services/frontend/src/components/Toolbar.tsx services/frontend/src/components/map/MapView.tsx
git commit -m "feat(frontend): temperature and height contour layers with toolbar toggles"
```

---

## Task 6: Integration Smoke Test

- [ ] **Step 1: Rebuild and start**

```bash
cd /Users/greg/Development/cirrus
docker compose down -v
docker compose build backend frontend
docker compose up -d
```

Wait for all services healthy.

- [ ] **Step 2: Trigger data fetch if needed**

```bash
curl -X POST http://localhost:8081/api/fetch
```

Wait for decoder to finish (check logs).

- [ ] **Step 3: Verify /api/gridded endpoint**

```bash
curl -s "http://localhost:8080/api/gridded?parameter=TMP&level_hpa=300&forecast_hour=6&thin=2" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(f'parameter={d[\"parameter\"]}, ni={d[\"ni\"]}, nj={d[\"nj\"]}')
print(f'lats: {d[\"lats\"][0]:.1f} to {d[\"lats\"][-1]:.1f} ({len(d[\"lats\"])} values)')
print(f'lons: {d[\"lons\"][0]:.1f} to {d[\"lons\"][-1]:.1f} ({len(d[\"lons\"])} values)')
print(f'values: {len(d[\"values\"])} (expected {d[\"ni\"] * d[\"nj\"]})')
print(f'sample value (K): {d[\"values\"][0]:.1f} ({d[\"values\"][0] - 273.15:.1f}°C)')
"
```

Expected: TMP data with ni×nj values, lats -90 to 90, lons -180 to ~180.

- [ ] **Step 4: Verify /api/gridded works for HGT**

```bash
curl -s "http://localhost:8080/api/gridded?parameter=HGT&level_hpa=300&forecast_hour=6&thin=2" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(f'parameter={d[\"parameter\"]}, sample value: {d[\"values\"][len(d[\"values\"])//2]:.0f}m')
"
```

Expected: HGT data with geopotential height values (~9000-9500m at 300 hPa).

- [ ] **Step 5: Open browser and test contours**

Open `http://localhost:3000`. Click "Temp" to toggle temperature contours — should see red isotherms. Click "Height" to toggle height contours — should see blue contour lines with H/L labels.

- [ ] **Step 6: Fix any issues and commit**

```bash
cd /Users/greg/Development/cirrus
docker compose down
git add -A
git commit -m "fix: address issues found during contouring integration test"
```
