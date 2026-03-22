# Wind Barb Visualization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display wind barbs on the MapLibre map from GRIB2 data in PostgreSQL, with UI controls for model run, forecast hour, and flight level selection.

**Architecture:** The Rust backend serves computed wind speed/direction via `/api/wind` and metadata via `/api/gridded/meta`. The React frontend uses Zustand for state, Deck.gl IconLayer for rendering wind barbs with programmatically generated SVG sprites, and a toolbar/status bar for controls.

**Tech Stack:** Rust (Axum, sqlx, chrono), React 18, TypeScript 5, Deck.gl 9.x, MapLibre GL JS, Zustand.

**Spec:** `docs/superpowers/specs/2026-03-21-wind-barb-visualization-design.md`

**Reference code:** `/Users/greg/Development/cirrus-old/frontend/` — proven wind barb rendering code to port.

---

## File Map

### Backend (`services/backend/`)
| File | Responsibility |
|---|---|
| `services/backend/Cargo.toml` | Add chrono dependency |
| `services/backend/src/main.rs` | Add routes, pass pool via state |
| `services/backend/src/wind.rs` | `/api/wind` handler: query U/V, compute speed/direction, thin, return JSON |
| `services/backend/src/meta.rs` | `/api/gridded/meta` handler: query available runs/hours/levels |

### Frontend (`services/frontend/`)
| File | Responsibility |
|---|---|
| `services/frontend/package.json` | Add deck.gl dependencies |
| `services/frontend/src/stores/appStore.ts` | Zustand store: wind data, selections, meta, cursor |
| `services/frontend/src/utils/windBarbs.ts` | Ported from cirrus-old: SVG generation, icon mapping, key lookup |
| `services/frontend/src/utils/windBarbAtlas.ts` | Runtime sprite atlas generation from SVGs |
| `services/frontend/src/components/map/WindBarbLayer.ts` | Deck.gl IconLayer factory |
| `services/frontend/src/components/map/MapView.tsx` | MapLibre + Deck.gl integration (replaces App.tsx map code) |
| `services/frontend/src/components/Toolbar.tsx` | Model run, forecast hour, flight level selectors, layer toggle |
| `services/frontend/src/components/StatusBar.tsx` | Run/valid time display + cursor coordinates |
| `services/frontend/src/App.tsx` | Shell: toolbar + map + status bar |
| `services/frontend/src/App.css` | Layout styles for toolbar/map/status bar |

---

## Task 1: Backend — Dependencies and Routing Structure

**Files:**
- Modify: `services/backend/Cargo.toml`
- Modify: `services/backend/src/main.rs`

- [ ] **Step 1: Add chrono to backend Cargo.toml**

Add `chrono = { workspace = true }` to `[dependencies]` in `services/backend/Cargo.toml`.

- [ ] **Step 2: Restructure main.rs for shared state**

Rewrite `services/backend/src/main.rs` to pass the DB pool as Axum shared state and add route stubs:

```rust
mod meta;
mod wind;

use axum::{routing::get, Json, Router};
use serde_json::{json, Value};
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use std::env;
use std::sync::Arc;

const SERVICE_NAME: &str = "backend";
const PORT: u16 = 8080;

async fn health() -> Json<Value> {
    Json(json!({"status": "ok", "service": SERVICE_NAME}))
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .init();

    let database_url = env::var("DATABASE_URL").expect("DATABASE_URL must be set");

    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(&database_url)
        .await
        .expect("Failed to connect to database");

    let _conn = pool.acquire().await.expect("Failed to acquire connection");
    tracing::info!("{SERVICE_NAME} connected to database");

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/wind", get(wind::get_wind))
        .route("/api/gridded/meta", get(meta::get_meta))
        .with_state(pool);

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{PORT}"))
        .await
        .expect("Failed to bind");
    tracing::info!("{SERVICE_NAME} listening on port {PORT}");

    axum::serve(listener, app).await.expect("Server error");
}
```

- [ ] **Step 3: Verify compiles (with empty module stubs)**

Create empty stub files so the workspace compiles:

`services/backend/src/wind.rs`:
```rust
use axum::{extract::State, Json};
use serde_json::Value;
use sqlx::PgPool;

pub async fn get_wind(State(_pool): State<PgPool>) -> Json<Value> {
    Json(serde_json::json!({"error": "not implemented"}))
}
```

`services/backend/src/meta.rs`:
```rust
use axum::{extract::State, Json};
use serde_json::Value;
use sqlx::PgPool;

pub async fn get_meta(State(_pool): State<PgPool>) -> Json<Value> {
    Json(serde_json::json!({"runs": []}))
}
```

```bash
cd /Users/greg/Development/cirrus/services
cargo check -p backend
```

Expected: compiles.

- [ ] **Step 4: Commit**

```bash
cd /Users/greg/Development/cirrus
git add services/backend/
git commit -m "feat(backend): add routing structure with wind and meta endpoint stubs"
```

---

## Task 2: Backend — `/api/gridded/meta` Endpoint

**Files:**
- Modify: `services/backend/src/meta.rs`

- [ ] **Step 1: Implement meta.rs**

Replace `services/backend/src/meta.rs`:

```rust
use axum::{extract::State, Json};
use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::PgPool;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Serialize)]
pub struct MetaResponse {
    runs: Vec<RunMeta>,
}

#[derive(Serialize)]
pub struct RunMeta {
    run_time: DateTime<Utc>,
    forecast_hours: Vec<i32>,
    parameters: Vec<String>,
    levels: Vec<i32>,
}

#[derive(sqlx::FromRow)]
struct FieldMeta {
    run_time: DateTime<Utc>,
    forecast_hour: i32,
    parameter: String,
    level_hpa: i32,
}

pub async fn get_meta(State(pool): State<PgPool>) -> Json<MetaResponse> {
    let rows = sqlx::query_as::<_, FieldMeta>(
        "SELECT DISTINCT run_time, forecast_hour, parameter, level_hpa \
         FROM gridded_fields \
         ORDER BY run_time DESC, forecast_hour, parameter, level_hpa"
    )
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    // Group by run_time
    let mut runs_map: BTreeMap<DateTime<Utc>, (BTreeSet<i32>, BTreeSet<String>, BTreeSet<i32>)> =
        BTreeMap::new();

    // Track which levels have both UGRD and VGRD per run.
    // Note: filtering is per-run, not per-(run, forecast_hour). GFS data is highly
    // regular — if a level exists for any hour, it exists for all hours in that run.
    let mut wind_levels: BTreeMap<(DateTime<Utc>, i32), BTreeSet<String>> = BTreeMap::new();

    for row in &rows {
        let entry = runs_map.entry(row.run_time).or_default();
        entry.0.insert(row.forecast_hour);
        entry.1.insert(row.parameter.clone());
        entry.2.insert(row.level_hpa);

        if row.parameter == "UGRD" || row.parameter == "VGRD" {
            wind_levels
                .entry((row.run_time, row.level_hpa))
                .or_default()
                .insert(row.parameter.clone());
        }
    }

    // Only include levels where both UGRD and VGRD exist
    let mut runs: Vec<RunMeta> = runs_map
        .into_iter()
        .rev() // most recent first
        .map(|(run_time, (hours, params, _all_levels))| {
            let levels: Vec<i32> = _all_levels
                .into_iter()
                .filter(|&lev| {
                    wind_levels
                        .get(&(run_time, lev))
                        .map(|p| p.contains("UGRD") && p.contains("VGRD"))
                        .unwrap_or(false)
                })
                .collect();
            RunMeta {
                run_time,
                forecast_hours: hours.into_iter().collect(),
                parameters: params.into_iter().collect(),
                levels,
            }
        })
        .collect();

    Json(MetaResponse { runs })
}
```

- [ ] **Step 2: Verify compiles**

```bash
cd /Users/greg/Development/cirrus/services
cargo check -p backend
```

- [ ] **Step 3: Commit**

```bash
cd /Users/greg/Development/cirrus
git add services/backend/src/meta.rs
git commit -m "feat(backend): /api/gridded/meta endpoint with wind-level filtering"
```

---

## Task 3: Backend — `/api/wind` Endpoint

**Files:**
- Modify: `services/backend/src/wind.rs`

- [ ] **Step 1: Implement wind.rs**

Replace `services/backend/src/wind.rs`:

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
pub struct WindQuery {
    level_hpa: i32,
    forecast_hour: i32,
    run_time: Option<DateTime<Utc>>,
    thin: Option<usize>,
}

#[derive(Serialize)]
pub struct WindResponse {
    run_time: DateTime<Utc>,
    forecast_hour: i32,
    valid_time: DateTime<Utc>,
    level_hpa: i32,
    count: usize,
    lats: Vec<f32>,
    lons: Vec<f32>,
    speeds: Vec<f32>,
    directions: Vec<f32>,
}

#[derive(sqlx::FromRow)]
struct GriddedRow {
    run_time: DateTime<Utc>,
    valid_time: DateTime<Utc>,
    ni: i32,
    nj: i32,
    lat_first: f64,
    lon_first: f64,
    d_lat: f64,
    d_lon: f64,
    values: Vec<u8>,
}

pub async fn get_wind(
    State(pool): State<PgPool>,
    Query(params): Query<WindQuery>,
) -> Result<Json<WindResponse>, StatusCode> {
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

    // Fetch UGRD
    let u_row = sqlx::query_as::<_, GriddedRow>(
        "SELECT run_time, valid_time, ni, nj, lat_first, lon_first, d_lat, d_lon, values \
         FROM gridded_fields \
         WHERE parameter = 'UGRD' AND level_hpa = $1 AND forecast_hour = $2 AND run_time = $3"
    )
    .bind(params.level_hpa)
    .bind(params.forecast_hour)
    .bind(run_time)
    .fetch_optional(&pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .ok_or(StatusCode::NOT_FOUND)?;

    // Fetch VGRD
    let v_row = sqlx::query_as::<_, GriddedRow>(
        "SELECT run_time, valid_time, ni, nj, lat_first, lon_first, d_lat, d_lon, values \
         FROM gridded_fields \
         WHERE parameter = 'VGRD' AND level_hpa = $1 AND forecast_hour = $2 AND run_time = $3"
    )
    .bind(params.level_hpa)
    .bind(params.forecast_hour)
    .bind(run_time)
    .fetch_optional(&pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .ok_or(StatusCode::NOT_FOUND)?;

    // Decode BYTEA to f32 arrays
    let u_vals = bytes_to_f32(&u_row.values);
    let v_vals = bytes_to_f32(&v_row.values);

    let ni = u_row.ni as usize;
    let nj = u_row.nj as usize;

    // Build thinned output arrays
    let mut lats = Vec::new();
    let mut lons = Vec::new();
    let mut speeds = Vec::new();
    let mut directions = Vec::new();

    for j in (0..nj).step_by(thin) {
        for i in (0..ni).step_by(thin) {
            let idx = j * ni + i;
            if idx >= u_vals.len() || idx >= v_vals.len() {
                continue;
            }

            let u = u_vals[idx] as f64;
            let v = v_vals[idx] as f64;

            let lat = u_row.lat_first + (j as f64) * u_row.d_lat;
            // Handle grids that go N→S (d_lat negative) vs S→N
            let lon = u_row.lon_first + (i as f64) * u_row.d_lon;

            let speed_ms = (u * u + v * v).sqrt();
            let speed_kt = (speed_ms * 1.94384) as f32;
            let dir = ((270.0 - v.atan2(u).to_degrees()).rem_euclid(360.0)) as f32;

            lats.push(lat as f32);
            lons.push(lon as f32);
            speeds.push(speed_kt);
            directions.push(dir);
        }
    }

    Ok(Json(WindResponse {
        run_time,
        forecast_hour: params.forecast_hour,
        valid_time: u_row.valid_time,
        level_hpa: params.level_hpa,
        count: lats.len(),
        lats,
        lons,
        speeds,
        directions,
    }))
}

/// Reinterpret a byte slice as a Vec<f32> (little-endian).
fn bytes_to_f32(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect()
}
```

- [ ] **Step 2: Verify compiles**

```bash
cd /Users/greg/Development/cirrus/services
cargo check -p backend
```

- [ ] **Step 3: Commit**

```bash
cd /Users/greg/Development/cirrus
git add services/backend/src/wind.rs
git commit -m "feat(backend): /api/wind endpoint with U/V computation and thinning"
```

---

## Task 4: Frontend — Dependencies and Wind Barb Utilities

**Files:**
- Modify: `services/frontend/package.json`
- Create: `services/frontend/src/utils/windBarbs.ts`
- Create: `services/frontend/src/utils/windBarbAtlas.ts`

- [ ] **Step 1: Install Deck.gl dependencies**

```bash
cd /Users/greg/Development/cirrus/services/frontend
npm install @deck.gl/core @deck.gl/layers @deck.gl/mapbox
```

- [ ] **Step 2: Port windBarbs.ts from cirrus-old**

Copy `/Users/greg/Development/cirrus-old/frontend/src/utils/windBarbs.ts` to `services/frontend/src/utils/windBarbs.ts`. The file should be used as-is — it contains `getWindBarbKey()`, `generateWindBarbMapping()`, and `generateWindBarbSVG()`.

- [ ] **Step 3: Create windBarbAtlas.ts**

Create `services/frontend/src/utils/windBarbAtlas.ts` — generates a runtime canvas sprite atlas from the SVGs:

```typescript
import { generateWindBarbSVG, generateWindBarbMapping } from './windBarbs';
import type { WindBarbMapping } from './windBarbs';

const ICON_SIZE = 64;
const TOTAL_ICONS = 41; // calm + 5,10,...,200
const COLS = 10;
const ROWS = Math.ceil(TOTAL_ICONS / COLS);

let cachedAtlas: HTMLCanvasElement | null = null;
let cachedMapping: WindBarbMapping | null = null;

/**
 * Generate the wind barb sprite atlas canvas and icon mapping.
 * Results are cached — subsequent calls return the same objects.
 */
export async function getWindBarbAtlas(): Promise<{
  atlas: HTMLCanvasElement;
  mapping: WindBarbMapping;
}> {
  if (cachedAtlas && cachedMapping) {
    return { atlas: cachedAtlas, mapping: cachedMapping };
  }

  const canvas = document.createElement('canvas');
  canvas.width = COLS * ICON_SIZE;
  canvas.height = ROWS * ICON_SIZE;
  const ctx = canvas.getContext('2d')!;

  // Generate and render each SVG to the atlas
  const speeds = [0, ...Array.from({ length: 40 }, (_, i) => (i + 1) * 5)];

  const loadPromises = speeds.map((speed, index) => {
    const svg = generateWindBarbSVG(speed);
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.width = ICON_SIZE;
    img.height = ICON_SIZE;

    return new Promise<void>((resolve) => {
      img.onload = () => {
        const col = index % COLS;
        const row = Math.floor(index / COLS);
        ctx.drawImage(img, col * ICON_SIZE, row * ICON_SIZE, ICON_SIZE, ICON_SIZE);
        URL.revokeObjectURL(url);
        resolve();
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(); // skip failed icons
      };
      img.src = url;
    });
  });

  await Promise.all(loadPromises);

  cachedAtlas = canvas;
  cachedMapping = generateWindBarbMapping();

  return { atlas: cachedAtlas, mapping: cachedMapping };
}
```

- [ ] **Step 4: Commit**

```bash
cd /Users/greg/Development/cirrus
git add services/frontend/package.json services/frontend/package-lock.json services/frontend/src/utils/
git commit -m "feat(frontend): wind barb SVG generation and runtime sprite atlas"
```

---

## Task 5: Frontend — Zustand Store

**Files:**
- Create: `services/frontend/src/stores/appStore.ts`

- [ ] **Step 1: Create appStore.ts**

Create `services/frontend/src/stores/appStore.ts`:

```typescript
import { create } from 'zustand';

export interface WindPoint {
  lat: number;
  lon: number;
  speed: number;
  direction: number;
}

export interface RunMeta {
  run_time: string;
  forecast_hours: number[];
  parameters: string[];
  levels: number[];
}

interface AppState {
  // Wind data
  windData: WindPoint[];
  windLoading: boolean;
  windError: string | null;

  // Selections
  selectedRunTime: string | null;
  selectedForecastHour: number;
  selectedLevel: number;
  windVisible: boolean;

  // Available data
  availableRuns: RunMeta[];
  metaLoading: boolean;

  // Map state
  mapZoom: number;
  cursorCoords: { lat: number; lon: number } | null;

  // Derived display values
  dataRunTime: string | null;
  dataValidTime: string | null;
  dataForecastHour: number | null;

  // Actions
  fetchMeta: () => Promise<void>;
  fetchWindData: () => Promise<void>;
  setRunTime: (rt: string) => void;
  setForecastHour: (h: number) => void;
  setLevel: (l: number) => void;
  toggleWind: () => void;
  setMapZoom: (z: number) => void;
  setCursorCoords: (c: { lat: number; lon: number } | null) => void;
}

/**
 * Zoom-dependent stride for client-side wind barb thinning.
 * Applied on top of the server-side `thin` parameter.
 */
export function windBarbStride(zoom: number): number {
  if (zoom < 3) return 4;
  if (zoom < 4) return 3;
  if (zoom < 5) return 2;
  return 1;
}

export const useAppStore = create<AppState>((set, get) => ({
  windData: [],
  windLoading: false,
  windError: null,

  selectedRunTime: null,
  selectedForecastHour: 6,
  selectedLevel: 300,
  windVisible: true,

  availableRuns: [],
  metaLoading: false,

  mapZoom: 2,
  cursorCoords: null,

  dataRunTime: null,
  dataValidTime: null,
  dataForecastHour: null,

  fetchMeta: async () => {
    set({ metaLoading: true });
    try {
      const res = await fetch('/api/gridded/meta');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const runs: RunMeta[] = data.runs ?? [];
      set({ availableRuns: runs, metaLoading: false });

      // Auto-select most recent run and first forecast hour if not already set
      if (runs.length > 0 && !get().selectedRunTime) {
        const latest = runs[0];
        set({
          selectedRunTime: latest.run_time,
          selectedForecastHour: latest.forecast_hours[0] ?? 6,
          selectedLevel: latest.levels.includes(300) ? 300 : (latest.levels[0] ?? 300),
        });
        get().fetchWindData();
      }
    } catch {
      set({ metaLoading: false });
    }
  },

  fetchWindData: async () => {
    const { selectedRunTime, selectedForecastHour, selectedLevel } = get();
    set({ windLoading: true, windError: null });

    try {
      const params = new URLSearchParams({
        level_hpa: String(selectedLevel),
        forecast_hour: String(selectedForecastHour),
        thin: '4',
      });
      if (selectedRunTime) {
        params.set('run_time', selectedRunTime);
      }

      const res = await fetch(`/api/wind?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const points: WindPoint[] = [];
      for (let i = 0; i < data.count; i++) {
        points.push({
          lat: data.lats[i],
          lon: data.lons[i],
          speed: data.speeds[i],
          direction: data.directions[i],
        });
      }

      set({
        windData: points,
        windLoading: false,
        dataRunTime: data.run_time ?? null,
        dataValidTime: data.valid_time ?? null,
        dataForecastHour: data.forecast_hour ?? null,
      });
    } catch (err) {
      set({
        windError: err instanceof Error ? err.message : 'Unknown error',
        windLoading: false,
      });
    }
  },

  setRunTime: (rt: string) => {
    const run = get().availableRuns.find(r => r.run_time === rt);
    const updates: Partial<AppState> = { selectedRunTime: rt };
    // Reset forecast hour if current selection isn't available in new run
    if (run && !run.forecast_hours.includes(get().selectedForecastHour)) {
      updates.selectedForecastHour = run.forecast_hours[0] ?? 6;
    }
    if (run && !run.levels.includes(get().selectedLevel)) {
      updates.selectedLevel = run.levels.includes(300) ? 300 : (run.levels[0] ?? 300);
    }
    set(updates);
    get().fetchWindData();
  },

  setForecastHour: (h: number) => {
    set({ selectedForecastHour: h });
    get().fetchWindData();
  },

  setLevel: (l: number) => {
    set({ selectedLevel: l });
    get().fetchWindData();
  },

  toggleWind: () => set((s) => ({ windVisible: !s.windVisible })),

  setMapZoom: (z: number) => set({ mapZoom: z }),
  setCursorCoords: (c) => set({ cursorCoords: c }),
}));
```

- [ ] **Step 2: Commit**

```bash
cd /Users/greg/Development/cirrus
git add services/frontend/src/stores/appStore.ts
git commit -m "feat(frontend): Zustand store with wind data, meta, and selection state"
```

---

## Task 6: Frontend — Wind Barb Layer and Map Component

**Files:**
- Create: `services/frontend/src/components/map/WindBarbLayer.ts`
- Create: `services/frontend/src/components/map/MapView.tsx`

- [ ] **Step 1: Create WindBarbLayer.ts**

Create `services/frontend/src/components/map/WindBarbLayer.ts`:

```typescript
import { IconLayer } from '@deck.gl/layers';
import { getWindBarbKey } from '../../utils/windBarbs';
import type { WindBarbMapping } from '../../utils/windBarbs';
import type { WindPoint } from '../../stores/appStore';

export function createWindBarbLayer(
  data: WindPoint[],
  iconAtlas: HTMLCanvasElement,
  iconMapping: WindBarbMapping,
): IconLayer<WindPoint> {
  return new IconLayer<WindPoint>({
    id: 'wind-barbs',
    data,
    getPosition: (d) => [d.lon, d.lat],
    getIcon: (d) => getWindBarbKey(d.speed),
    getAngle: (d) => -d.direction,
    getSize: 40,
    iconAtlas,
    iconMapping: iconMapping as Record<string, {x: number; y: number; width: number; height: number}>,
    sizeUnits: 'pixels',
    sizeMinPixels: 20,
    sizeMaxPixels: 50,
    pickable: false,
  });
}
```

- [ ] **Step 2: Create MapView.tsx**

Create `services/frontend/src/components/map/MapView.tsx`:

```tsx
import { useEffect, useRef, useCallback, useState } from 'react';
import { Map, NavigationControl } from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useAppStore, windBarbStride } from '../../stores/appStore';
import { createWindBarbLayer } from './WindBarbLayer';
import { getWindBarbAtlas } from '../../utils/windBarbAtlas';
import type { WindBarbMapping } from '../../utils/windBarbs';

export default function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const [atlas, setAtlas] = useState<{
    canvas: HTMLCanvasElement;
    mapping: WindBarbMapping;
  } | null>(null);

  const windData = useAppStore((s) => s.windData);
  const windVisible = useAppStore((s) => s.windVisible);
  const mapZoom = useAppStore((s) => s.mapZoom);
  const setMapZoom = useAppStore((s) => s.setMapZoom);
  const setCursorCoords = useAppStore((s) => s.setCursorCoords);

  // Load atlas on mount
  useEffect(() => {
    getWindBarbAtlas().then(({ atlas: a, mapping: m }) => {
      setAtlas({ canvas: a, mapping: m });
    });
  }, []);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new Map({
      container: containerRef.current,
      style: 'https://demotiles.maplibre.org/style.json',
      center: [0, 30],
      zoom: 2,
    });

    map.addControl(new NavigationControl(), 'top-right');

    const overlay = new MapboxOverlay({ layers: [] });
    map.addControl(overlay);

    mapRef.current = map;
    overlayRef.current = overlay;

    map.on('zoomend', () => setMapZoom(map.getZoom()));

    let lastCoordUpdate = 0;
    map.on('mousemove', (e) => {
      const now = Date.now();
      if (now - lastCoordUpdate > 16) {
        setCursorCoords({ lat: e.lngLat.lat, lon: e.lngLat.lng });
        lastCoordUpdate = now;
      }
    });
    map.on('mouseout', () => setCursorCoords(null));

    return () => {
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
    };
  }, []);

  // Update Deck.gl layers when data changes
  useEffect(() => {
    if (!overlayRef.current || !atlas) return;

    const layers = [];

    if (windVisible && windData.length > 0) {
      const stride = windBarbStride(mapZoom);
      const filtered = stride === 1
        ? windData
        : windData.filter((_, i) => i % stride === 0);
      layers.push(createWindBarbLayer(filtered, atlas.canvas, atlas.mapping));
    }

    overlayRef.current.setProps({ layers });
  }, [windData, windVisible, mapZoom, atlas]);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }}
    />
  );
}
```

- [ ] **Step 3: Commit**

```bash
cd /Users/greg/Development/cirrus
git add services/frontend/src/components/map/
git commit -m "feat(frontend): MapView with Deck.gl overlay and wind barb layer"
```

---

## Task 7: Frontend — Toolbar and StatusBar Components

**Files:**
- Create: `services/frontend/src/components/Toolbar.tsx`
- Create: `services/frontend/src/components/StatusBar.tsx`

- [ ] **Step 1: Create Toolbar.tsx**

Create `services/frontend/src/components/Toolbar.tsx`:

```tsx
import { useAppStore } from '../stores/appStore';

/** Approximate pressure (hPa) → flight level label */
function flightLevelLabel(hpa: number): string {
  const map: Record<number, string> = {
    850: 'FL050', 700: 'FL100', 600: 'FL140', 500: 'FL180',
    400: 'FL240', 300: 'FL300', 250: 'FL340', 200: 'FL390',
    150: 'FL450', 100: 'FL530', 70: 'FL600',
  };
  return map[hpa] ?? `${hpa} hPa`;
}

/** Format ISO timestamp for display, e.g. "21 Mar 18Z" */
function formatRunTime(iso: string): string {
  const d = new Date(iso);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${String(d.getUTCHours()).padStart(2, '0')}Z`;
}

/** Format valid time from run_time + forecast_hour */
function formatValidTime(runIso: string, fh: number): string {
  const d = new Date(new Date(runIso).getTime() + fh * 3600000);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${String(d.getUTCHours()).padStart(2, '0')}Z`;
}

export default function Toolbar() {
  const availableRuns = useAppStore((s) => s.availableRuns);
  const selectedRunTime = useAppStore((s) => s.selectedRunTime);
  const selectedForecastHour = useAppStore((s) => s.selectedForecastHour);
  const selectedLevel = useAppStore((s) => s.selectedLevel);
  const windVisible = useAppStore((s) => s.windVisible);
  const windLoading = useAppStore((s) => s.windLoading);
  const setRunTime = useAppStore((s) => s.setRunTime);
  const setForecastHour = useAppStore((s) => s.setForecastHour);
  const setLevel = useAppStore((s) => s.setLevel);
  const toggleWind = useAppStore((s) => s.toggleWind);

  const currentRun = availableRuns.find((r) => r.run_time === selectedRunTime);

  return (
    <div className="toolbar">
      <label>
        Run:
        <select
          value={selectedRunTime ?? ''}
          onChange={(e) => setRunTime(e.target.value)}
          disabled={availableRuns.length === 0}
        >
          {availableRuns.map((r) => (
            <option key={r.run_time} value={r.run_time}>
              {formatRunTime(r.run_time)}
            </option>
          ))}
        </select>
      </label>

      <label>
        Forecast:
        <select
          value={selectedForecastHour}
          onChange={(e) => setForecastHour(Number(e.target.value))}
        >
          {(currentRun?.forecast_hours ?? []).map((h) => (
            <option key={h} value={h}>
              T+{h} ({selectedRunTime ? formatValidTime(selectedRunTime, h) : ''})
            </option>
          ))}
        </select>
      </label>

      <label>
        Level:
        <select
          value={selectedLevel}
          onChange={(e) => setLevel(Number(e.target.value))}
        >
          {(currentRun?.levels ?? []).map((l) => (
            <option key={l} value={l}>
              {flightLevelLabel(l)} ({l} hPa)
            </option>
          ))}
        </select>
      </label>

      <button
        className={windVisible ? 'toggle-btn active' : 'toggle-btn'}
        onClick={toggleWind}
      >
        Wind {windLoading ? '...' : windVisible ? 'ON' : 'OFF'}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Create StatusBar.tsx**

Create `services/frontend/src/components/StatusBar.tsx`:

```tsx
import { useAppStore } from '../stores/appStore';

function formatCoord(lat: number, lon: number): string {
  const latStr = `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'}`;
  const lonStr = `${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`;
  return `${latStr} ${lonStr}`;
}

function formatRunTime(iso: string): string {
  const d = new Date(iso);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${String(d.getUTCHours()).padStart(2, '0')}Z`;
}

export default function StatusBar() {
  const cursorCoords = useAppStore((s) => s.cursorCoords);
  const dataRunTime = useAppStore((s) => s.dataRunTime);
  const dataValidTime = useAppStore((s) => s.dataValidTime);
  const dataForecastHour = useAppStore((s) => s.dataForecastHour);
  const windError = useAppStore((s) => s.windError);

  return (
    <div className="status-bar">
      <div className="status-left">
        {windError ? (
          <span className="error">{windError}</span>
        ) : dataRunTime ? (
          <span>
            Run: {formatRunTime(dataRunTime)}
            {dataForecastHour != null && ` | T+${dataForecastHour}`}
            {dataValidTime && ` | Valid: ${formatRunTime(dataValidTime)}`}
          </span>
        ) : (
          <span>No data loaded</span>
        )}
      </div>
      <div className="status-right">
        {cursorCoords ? formatCoord(cursorCoords.lat, cursorCoords.lon) : ''}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
cd /Users/greg/Development/cirrus
git add services/frontend/src/components/Toolbar.tsx services/frontend/src/components/StatusBar.tsx
git commit -m "feat(frontend): toolbar with run/hour/level selectors and status bar"
```

---

## Task 8: Frontend — App Shell and Styles

**Files:**
- Modify: `services/frontend/src/App.tsx`
- Create: `services/frontend/src/App.css`

- [ ] **Step 1: Rewrite App.tsx**

Replace `services/frontend/src/App.tsx`:

```tsx
import { useEffect } from 'react';
import { useAppStore } from './stores/appStore';
import Toolbar from './components/Toolbar';
import StatusBar from './components/StatusBar';
import MapView from './components/map/MapView';
import './App.css';

export default function App() {
  const fetchMeta = useAppStore((s) => s.fetchMeta);

  useEffect(() => {
    fetchMeta();
  }, []);

  return (
    <div className="app">
      <Toolbar />
      <div className="map-container">
        <MapView />
      </div>
      <StatusBar />
    </div>
  );
}
```

- [ ] **Step 2: Create App.css**

Create `services/frontend/src/App.css`:

```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body, #root {
  width: 100%;
  height: 100%;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
}

.app {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  background: #1a1a2e;
  color: #e0e0e0;
  border-bottom: 1px solid #333;
  z-index: 10;
  flex-shrink: 0;
}

.toolbar label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #aaa;
}

.toolbar select {
  background: #16213e;
  color: #e0e0e0;
  border: 1px solid #444;
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 13px;
  font-family: monospace;
}

.toggle-btn {
  background: #333;
  color: #aaa;
  border: 1px solid #555;
  border-radius: 4px;
  padding: 4px 12px;
  cursor: pointer;
  font-size: 13px;
}

.toggle-btn.active {
  background: #0a3d62;
  color: #4fc3f7;
  border-color: #4fc3f7;
}

.map-container {
  flex: 1;
  position: relative;
}

.status-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 16px;
  background: #1a1a2e;
  color: #aaa;
  border-top: 1px solid #333;
  font-size: 12px;
  font-family: monospace;
  z-index: 10;
  flex-shrink: 0;
}

.status-left .error {
  color: #ef5350;
}

.status-right {
  color: #888;
}
```

- [ ] **Step 3: Verify frontend builds**

```bash
cd /Users/greg/Development/cirrus/services/frontend
npm run build
```

Expected: builds successfully.

- [ ] **Step 4: Commit**

```bash
cd /Users/greg/Development/cirrus
git add services/frontend/src/App.tsx services/frontend/src/App.css
git commit -m "feat(frontend): app shell with toolbar, map, and status bar layout"
```

---

## Task 9: Integration Smoke Test

- [ ] **Step 1: Wipe Postgres volume and rebuild**

```bash
cd /Users/greg/Development/cirrus
docker compose down -v
docker compose build backend frontend
```

- [ ] **Step 2: Start the full stack**

```bash
docker compose up -d
```

Wait for all services to be healthy.

- [ ] **Step 3: Trigger a data fetch if no data exists**

```bash
curl -X POST http://localhost:8081/api/fetch
```

Wait for acquisition + decoder to complete (watch logs).

- [ ] **Step 4: Verify backend endpoints**

```bash
curl -s http://localhost:8080/api/gridded/meta | python3 -m json.tool | head -20
curl -s "http://localhost:8080/api/wind?level_hpa=300&forecast_hour=6&thin=8" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'count={d[\"count\"]}, speeds[0:3]={d[\"speeds\"][:3]}')"
```

Expected: meta returns available runs with levels/hours; wind returns data with count > 0.

- [ ] **Step 5: Open the frontend**

Open `http://localhost:3000` in a browser.

Expected:
- Dark toolbar at top with Run, Forecast, Level dropdowns and Wind toggle
- MapLibre map filling the viewport with wind barbs rendered at FL300
- Status bar at bottom showing run time, forecast hour, valid time
- Cursor coordinates update on mousemove
- Changing selectors fetches and renders new wind data

- [ ] **Step 6: Fix any issues and commit**

```bash
cd /Users/greg/Development/cirrus
docker compose down
git add -A
git commit -m "fix: address issues found during wind barb integration test"
```
