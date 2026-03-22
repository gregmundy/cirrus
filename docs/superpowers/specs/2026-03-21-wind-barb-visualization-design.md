# Wind Barb Visualization Design

**Date:** 2026-03-21
**Status:** Draft
**Scope:** End-to-end wind barb display — backend API, Deck.gl rendering on Mercator map, UI controls for model run / forecast hour / flight level selection.

---

## 1. Goal

Display wind barbs on the MapLibre map using data from the `gridded_fields` table populated by the GRIB2 acquisition pipeline. The user can select a model run, forecast hour, and flight level. Wind barbs render as standard meteorological symbols (pennants, barbs, half-barbs) via Deck.gl IconLayer.

### Success Criteria

- `GET /api/wind` returns computed wind speed (kt) and direction from U/V components
- `GET /api/gridded/meta` returns available runs, forecast hours, and levels
- Wind barbs render on the MapLibre map with correct rotation and density
- Toolbar provides model run, forecast hour, and flight level selectors
- Layer toggle shows/hides wind barbs
- Status bar shows run time, valid time, and cursor coordinates
- Changing any selector fetches and renders new data without page reload

---

## 2. Backend API

Two new endpoints added to the `backend` service (Rust/Axum).

### 2.1 `GET /api/wind`

Returns wind speed and direction computed from U/V gridded fields, thinned for display.

**Query parameters:**

| Param | Required | Default | Description |
|---|---|---|---|
| `level_hpa` | yes | — | Pressure level (e.g., 300) |
| `forecast_hour` | yes | — | Forecast hour (e.g., 12) |
| `run_time` | no | latest | ISO 8601 run time |
| `thin` | no | 4 | Take every Nth grid point |

**Logic:**
1. If `run_time` is omitted, query `SELECT DISTINCT run_time FROM gridded_fields ORDER BY run_time DESC LIMIT 1`
2. Fetch UGRD row: `SELECT * FROM gridded_fields WHERE parameter = 'UGRD' AND level_hpa = $1 AND forecast_hour = $2 AND run_time = $3`
3. Fetch VGRD row with the same filters
4. If either is missing, return 404
5. Decode BYTEA values to `Vec<f32>` (reinterpret bytes as little-endian float32)
6. Read `valid_time` from the UGRD row for inclusion in the response
7. For each grid point (thinned by stride):
   - Compute speed: `sqrt(u² + v²) × 1.94384` (m/s to knots)
   - Compute direction: `(270.0 - atan2(v, u).to_degrees()).rem_euclid(360.0)` (meteorological convention: direction wind blows FROM)
   - Compute lat/lon from grid position using `lat_first`, `d_lat`, `lon_first`, `d_lon`
7. Return JSON

**Response format:**
```json
{
  "run_time": "2026-03-21T18:00:00Z",
  "forecast_hour": 12,
  "valid_time": "2026-03-22T06:00:00Z",
  "level_hpa": 300,
  "count": 64800,
  "lats": [90.0, 90.0, ...],
  "lons": [0.0, 0.25, ...],
  "speeds": [25.3, 31.7, ...],
  "directions": [270.0, 265.0, ...]
}
```

Arrays are parallel — index N across all arrays describes one grid point.

### 2.2 `GET /api/gridded/meta`

Returns metadata about available data in the database, used to populate frontend selectors.

**Response format:**
```json
{
  "runs": [
    {
      "run_time": "2026-03-21T18:00:00Z",
      "forecast_hours": [6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36],
      "parameters": ["UGRD", "VGRD", "TMP", "HGT", "RH"],
      "levels": [70, 100, 150, 200, 250, 300, 400, 500, 600, 700, 850]
    }
  ]
}
```

**Logic:**
1. `SELECT DISTINCT run_time, forecast_hour, parameter, level_hpa FROM gridded_fields ORDER BY run_time DESC, forecast_hour, parameter, level_hpa`
2. Group in application code by `run_time`, collecting unique forecast hours, parameters, and levels per run
3. For `levels`, only include levels where both UGRD and VGRD exist (so the flight level selector never shows levels that would 404 on `/api/wind`)

### 2.3 Backend Dependencies

The `backend` crate needs `chrono` added to its dependencies (already in workspace). It already has `sqlx`, `axum`, `serde`, `serde_json`.

---

## 3. Frontend — Wind Barb Rendering

### 3.1 Wind Barb SVG Generation

Ported from `cirrus-old/frontend/src/utils/windBarbs.ts`.

`generateWindBarbSVG(speed)` composes standard meteorological wind barb symbols:
- Calm (0 kt): circle symbol
- Half barb: 5 kt
- Full barb: 10 kt
- Pennant (filled triangle): 50 kt

Generates SVGs for each 5kt increment from 0-200kt (41 icons). All icons point north; rotation is applied by the rendering layer.

### 3.2 Sprite Atlas

On app initialization, all 41 SVGs are rendered to a single canvas-based sprite atlas:
1. Generate each SVG via `generateWindBarbSVG(speed)`
2. Render each to a canvas element (consistent cell size, e.g., 64×64px)
3. Compose into a single atlas canvas (e.g., 41 cells in a row)
4. Build an `iconMapping` object mapping speed keys (`"calm"`, `"wb_5"`, `"wb_10"`, ... `"wb_200"`) to `{x, y, width, height}` atlas coordinates — matching the naming convention from `getWindBarbKey()` in the ported code

This is entirely runtime — no static asset file needed.

### 3.3 Deck.gl IconLayer

`WindBarbLayer.ts` creates a Deck.gl `IconLayer`:

```typescript
new IconLayer({
  id: 'wind-barbs',
  data: windPoints,
  getPosition: d => [d.lon, d.lat],
  getIcon: d => getWindBarbKey(d.speed),     // rounds to nearest 5kt
  getAngle: d => -d.direction,               // negate: deck.gl rotates CCW, met direction is CW from north
  getSize: 24,
  iconAtlas: atlasCanvas,
  iconMapping: iconMapping,
})
```

### 3.4 Zoom-Dependent Thinning

`windBarbStride(zoom)` returns a client-side stride multiplier:
- zoom < 3: stride 4 (show every 4th point from server data)
- zoom 3-4: stride 3
- zoom 4-5: stride 2
- zoom ≥ 5: stride 1 (show all server-provided points)

This is applied client-side by filtering the `windPoints` array, on top of the server-side `thin` parameter. The server thins the full 1440×721 grid; the client thins further based on viewport zoom.

### 3.5 MapLibre + Deck.gl Integration

Use `@deck.gl/mapbox`'s `MapboxOverlay` to add Deck.gl layers on top of the existing MapLibre map:

```typescript
const overlay = new MapboxOverlay({
  layers: [windBarbLayer]
});
map.addControl(overlay);
```

The overlay is updated whenever the wind data or zoom changes. Future layers (contours, hazards) are added to the same overlay's layers array.

---

## 4. Frontend — State Management

### 4.1 Zustand Store

```typescript
interface AppStore {
  // Wind data
  windData: WindPoint[] | null
  windLoading: boolean
  windError: string | null

  // Selections
  selectedRunTime: string | null      // ISO 8601; null = latest
  selectedForecastHour: number        // default: first available
  selectedLevel: number               // hPa; default: 300
  windVisible: boolean                // layer toggle; default: true

  // Available data (from /api/gridded/meta)
  availableRuns: RunMeta[]
  metaLoading: boolean

  // Map state
  mapZoom: number
  cursorCoords: { lat: number; lon: number } | null

  // Actions
  fetchMeta(): Promise<void>
  fetchWindData(): Promise<void>
  setRunTime(rt: string): void
  setForecastHour(h: number): void
  setLevel(l: number): void
  toggleWind(): void
  setMapZoom(z: number): void
  setCursorCoords(c: { lat: number; lon: number } | null): void
}

interface WindPoint {
  lat: number
  lon: number
  speed: number       // knots
  direction: number   // degrees true (FROM)
}

interface RunMeta {
  run_time: string
  forecast_hours: number[]
  parameters: string[]
  levels: number[]
}
```

### 4.2 Data Flow

- `setRunTime`, `setForecastHour`, `setLevel` each update the store value and call `fetchWindData()`
- `fetchWindData()` builds the `/api/wind` URL from current selections, fetches, parses response into `WindPoint[]`
- `toggleWind()` flips `windVisible` — no refetch needed, layer just hides/shows

---

## 5. Frontend — UI Layout

### 5.1 Toolbar

Horizontal bar at the top of the screen, left to right:

| Control | Type | Content | Behavior |
|---|---|---|---|
| Model run | Dropdown | Formatted run times, e.g., "21 Mar 18Z" | Populated from meta; changing triggers refetch |
| Forecast hour | Dropdown | "T+6", "T+12", etc. with valid time, e.g., "T+12 (22 Mar 06Z)" | Filtered to selected run's available hours |
| Flight level | Dropdown | "FL300 (300 hPa)", "FL250 (250 hPa)", etc. | Filtered to selected run's available levels |
| Wind barbs | Toggle button | On/Off | Shows/hides the layer |

Flight levels displayed using approximate FL mapping:
- 850 hPa → FL050, 700 → FL100, 600 → FL140, 500 → FL180, 400 → FL240, 300 → FL300, 250 → FL340, 200 → FL390, 150 → FL450, 100 → FL530, 70 → FL600

### 5.2 Status Bar

Horizontal bar at the bottom of the screen:

| Position | Content |
|---|---|
| Left | "Run: 21 Mar 18Z \| T+12 \| Valid: 22 Mar 06Z" |
| Right | "45.2°N 122.7°W" (cursor coordinates, updated on mousemove) |

### 5.3 No Side Panel

No side panel, legend, or feature info in this iteration. Those come with SIGWX and OPMET work.

---

## 6. Data Lifecycle

### 6.1 On App Startup

1. Fetch `GET /api/gridded/meta` → populate store's `availableRuns`
2. Auto-select most recent run and first forecast hour
3. Fetch `GET /api/wind` with defaults (level=300, first hour, latest run)
4. Generate wind barb sprite atlas (one-time)
5. Render wind barbs on map

### 6.2 On Selector Change

1. Update store value
2. Fetch new wind data
3. Wind barb layer re-renders with new data

### 6.3 On Map Zoom

1. `mapZoom` updates in store on MapLibre `zoomend`
2. Wind barb layer re-renders with adjusted client-side stride — no refetch

### 6.4 Error Handling

- `/api/gridded/meta` returns empty → show "No data available" in toolbar
- `/api/wind` fails → show error in status bar, keep previously loaded barbs visible
- Backend unreachable → Docker health check handles container visibility

### 6.5 No Auto-Refresh

User manually triggers data changes via selectors. Auto-refresh via WebSocket is out of scope for this iteration.

---

## 7. Files Changed

### Backend (`services/backend/`)
- `services/backend/Cargo.toml` — add `chrono = { workspace = true }`
- `services/backend/src/main.rs` — add routes for `/api/wind` and `/api/gridded/meta`
- New source files for route handlers, DB queries, and wind computation

### Frontend (`services/frontend/`)
- `services/frontend/package.json` — add `@deck.gl/core`, `@deck.gl/layers`, `@deck.gl/mapbox`
- New/modified source files for store, wind barb utils, map integration, toolbar, status bar

### Reference
- Port `windBarbs.ts` from `/Users/greg/Development/cirrus-old/frontend/src/utils/windBarbs.ts`

---

## 8. What Is Explicitly Out of Scope

- Polar stereographic projection (future iteration with SIGWX)
- Temperature/height contouring
- Turbulence, icing, CB visualization
- Side panel, legend, feature info panel
- Auto-refresh / WebSocket notifications
- SIGWX, OPMET, advisory data
- Wind barb hover tooltips (can be added later)
- Animation / time slider playback
