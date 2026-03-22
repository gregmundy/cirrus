# Temperature & Geopotential Height Contouring Design

**Date:** 2026-03-22
**Status:** Draft
**Scope:** Client-side temperature isotherms and geopotential height contours with H/L center detection, served by a generic backend gridded data endpoint.

---

## 1. Goal

Display temperature isotherms (red, 5°C intervals) and geopotential height contours (blue, level-adaptive intervals) on the MapLibre map as toggleable layers. Height contours include automatically detected H/L pressure center labels. All contour computation runs client-side using D3 marching squares on data served by a generic `/api/gridded` backend endpoint.

### Success Criteria

- `GET /api/gridded` serves any parameter's raw grid data (TMP, HGT, RH, etc.)
- Temperature contours render as smooth red isolines labeled in °C
- Height contours render as smooth blue isolines labeled in meters
- H and L extrema are detected and labeled on the height field
- Height contour interval adapts: 60m above FL240 (400 hPa), 30m at or below FL240
- Both layers are independently toggleable with lazy data loading
- Changing run/hour/level clears cached grids and refetches visible layers

---

## 2. Backend — `GET /api/gridded`

A generic endpoint added to the backend service alongside `/api/wind` and `/api/gridded/meta`.

### 2.1 Query Parameters

| Param | Required | Default | Description |
|---|---|---|---|
| `parameter` | yes | — | Field name: `TMP`, `HGT`, `RH`, etc. |
| `level_hpa` | yes | — | Pressure level (e.g., 300) |
| `forecast_hour` | yes | — | Forecast hour (e.g., 6) |
| `run_time` | no | latest | ISO 8601 run time |
| `thin` | no | 2 | Grid stride (lower = denser grid) |

### 2.2 Logic

1. If `run_time` is omitted, resolve to the latest available run (same pattern as `/api/wind`)
2. Fetch the row from `gridded_fields` matching `parameter`, `level_hpa`, `forecast_hour`, `run_time`
3. If not found, return 404
4. Decode BYTEA values to float32 array
5. Read `valid_time` from the row
6. Compute d_lat sign from `lat_first` vs `lat_last` (negate for N→S grids)
7. Compute thinned lat/lon 1D arrays and thinned values:
   - `lats`: array of `nj/thin` values from `lat_first` stepping by `d_lat * thin`
   - `lons`: array of `ni/thin` values from `lon_first` stepping by `d_lon * thin`, wrapped to -180/180
   - `values`: every `thin`-th point in both dimensions
8. Return JSON

### 2.3 Response Format

```json
{
  "parameter": "TMP",
  "run_time": "2026-03-21T18:00:00Z",
  "forecast_hour": 6,
  "valid_time": "2026-03-22T00:00:00Z",
  "level_hpa": 300,
  "ni": 720,
  "nj": 361,
  "lats": [90.0, 89.5, 89.0, ...],
  "lons": [-180.0, -179.5, -179.0, ...],
  "values": [223.4, 223.1, ...]
}
```

- `ni` and `nj` are the **post-thinning** grid dimensions — they equal `len(lons)` and `len(lats)` respectively, not the raw DB values
- `lats` is a 1D array of `nj` elements (one per row)
- `lons` is a 1D array of `ni` elements (one per column)
- `values` is a 1D array of `ni × nj` elements in row-major order: j (latitude index) is the outer dimension, i (longitude index) is the inner dimension, so `values[j * ni + i]`
- Values are in native units: Kelvin for TMP, geopotential meters for HGT
- Frontend reconstructs the 2D grid from `lats`, `lons`, `ni`, `nj`

### 2.4 Backend File

New file `services/backend/src/gridded.rs` with the handler, added as a route in `main.rs`.

---

## 3. Frontend — Contouring Pipeline

Ported from cirrus-old's proven implementation.

### 3.1 `utils/contourComputation.ts`

Pure computation module — no rendering dependencies. Ported directly from `/Users/greg/Development/cirrus-old/frontend/src/utils/contourComputation.ts`.

**`computeContourLines(ni, nj, lats, lons, values, options)`** → `{lines, labels}`

Pipeline:
1. Optional value conversion (e.g., K → °C)
2. Bilinear upsample the grid 4x for smooth curves
3. Compute contour thresholds at the specified interval
4. Run D3 `contours()` (marching squares) on the upsampled grid
5. Convert grid-space coordinates to lon/lat
6. Split contour rings at grid boundaries (removes d3's edge-closing artifacts)
7. Split at longitude-wrap seams (>90° lon jump between consecutive points)
8. Subsample labels by distance (40° lon / 20° lat spacing) to avoid clutter

**Types:**
```typescript
interface ContourLine {
  coordinates: [number, number][];  // [lon, lat] pairs
  value: number;
}

interface ContourLabel {
  position: [number, number];  // [lon, lat]
  text: string;
}
```

### 3.2 `utils/extremaDetection.ts`

Pure computation module for H/L center detection.

**`findExtrema(ni, nj, lats, lons, values, influenceRadius)`** → `{highs, lows}`

Algorithm:
1. For each grid point (skipping edges within 2 points of boundary):
   a. Collect all neighbor values within `influenceRadius` grid points
   b. If the point's value is the maximum in that neighborhood → candidate high
   c. If the minimum → candidate low
2. Proximity deduplication: for each type (highs, lows) separately, sort candidates by strength (highest value first for highs, lowest first for lows), then suppress any candidate within 15° of a stronger candidate of the same type
3. Return arrays of `Extremum` objects

**Default influence radius:** 10 grid points (~20° at thin=2). Detects synoptic-scale features while suppressing mesoscale noise. The proximity deduplication in step 2 prevents multiple labels on a single broad system.

**Type:**
```typescript
interface Extremum {
  position: [number, number];  // [lon, lat]
  value: number;
}
```

### 3.3 `components/map/ContourLayer.ts`

Deck.gl layer factory. Ported from cirrus-old with the generic `ContourOptions` pattern.

**`createGenericContourLayers(ni, nj, lats, lons, values, options)`** → `Layer[]`

Returns `[PathLayer, TextLayer]` for contour lines and labels.

**`createTemperatureLayers(data: GriddedData)`** → `Layer[]`
- Converts K → °C
- 5°C intervals
- Red lines: `[220, 60, 60, 180]`
- Red labels: `[180, 40, 40, 220]`
- Labels formatted as "-55°C"

**`createHeightLayers(data: GriddedData, levelHpa: number)`** → `Layer[]`
- Raw meters (no conversion)
- Interval: 60m when `levelHpa < 400`, 30m when `levelHpa >= 400`
- Blue lines: `[40, 80, 200, 180]`
- Blue labels: `[30, 60, 170, 220]`
- Labels formatted as "9240m"

**`createExtremaLayer(data: GriddedData)`** → `Layer[]`
- Runs `findExtrema` on the grid
- Returns TextLayer with bold "H" (red `[220, 40, 40]`) and "L" (blue `[40, 40, 220]`) characters
- Value label as secondary text underneath (e.g., "9420m")

---

## 4. Frontend — State & UI

### 4.1 Zustand Store Additions

```typescript
// New state
temperatureGrid: GriddedData | null
temperatureVisible: boolean
temperatureLoading: boolean
temperatureError: string | null

heightGrid: GriddedData | null
heightVisible: boolean
heightLoading: boolean
heightError: string | null

// New actions
toggleTemperature(): void
toggleHeight(): void
fetchTemperatureData(): Promise<void>
fetchHeightData(): Promise<void>
```

**`GriddedData` type** (shared):
```typescript
interface GriddedData {
  parameter: string
  run_time: string
  forecast_hour: number
  valid_time: string
  level_hpa: number
  ni: number
  nj: number
  lats: number[]
  lons: number[]
  values: number[]
}
```

### 4.2 Data Loading Behavior

- **Lazy loading:** Grid data fetched only when layer toggled ON
- **Caching:** Once fetched, cached in store across toggles (on/off/on doesn't refetch)
- **Invalidation:** Changing run time, forecast hour, or level clears all cached grids (`temperatureGrid = null`, `heightGrid = null`) and refetches any currently visible layers
- **Fetch URL:** `GET /api/gridded?parameter=TMP&level_hpa={level}&forecast_hour={hour}&run_time={run}&thin=2`

### 4.3 Toolbar

Two new toggle buttons after "Wind ON":
- "Temp" — toggles temperature isotherms
- "Height" — toggles geopotential height contours + H/L labels

Both show loading state ("...") while fetching, styled same as the Wind toggle.

### 4.4 MapView Layer Stack

Layers rendered bottom to top:
1. Height contour lines + labels (blue) — if visible
2. Height H/L extrema labels — if visible (rendered with height contours)
3. Temperature contour lines + labels (red) — if visible
4. Wind barbs (blue) — if visible (always on top)

---

## 5. Dependencies

### Backend
- No new dependencies — uses existing `sqlx`, `axum`, `chrono`, `serde`

### Frontend
- Add `d3-contour` — marching squares algorithm
- Add `@types/d3-contour` — TypeScript types

---

## 6. Files Changed

### Backend
- Create: `services/backend/src/gridded.rs` — `/api/gridded` handler
- Modify: `services/backend/src/main.rs` — add route

### Frontend
- Create: `services/frontend/src/utils/contourComputation.ts` — ported from cirrus-old
- Create: `services/frontend/src/utils/extremaDetection.ts` — H/L detection
- Create: `services/frontend/src/components/map/ContourLayer.ts` — Deck.gl layer factories
- Modify: `services/frontend/src/stores/appStore.ts` — add grid state, toggles, fetches
- Modify: `services/frontend/src/components/Toolbar.tsx` — add Temp/Height toggles
- Modify: `services/frontend/src/components/map/MapView.tsx` — add contour layers to overlay

### Reference
- Port from: `/Users/greg/Development/cirrus-old/frontend/src/utils/contourComputation.ts`
- Port from: `/Users/greg/Development/cirrus-old/frontend/src/components/map/ContourLayer.ts`

---

## 7. What Is Explicitly Out of Scope

- Geopotential height formatted as flight levels (display in meters for now)
- Contour interval customization UI (fixed intervals per parameter)
- Relative humidity visualization
- Tropopause contours
- Filled/shaded contours (color fills between isolines)
- Polar stereographic projection support
- Animation / time playback
