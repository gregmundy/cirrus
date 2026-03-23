# Tropopause + Max Wind (Jet Stream) Display

**Date:** 2026-03-22
**Criterion:** 2b.5 (Tropopause Height/Temperature), 2b.6 (Max Wind / Jet Stream)
**Status:** Approved

## Overview

Add two new map layers to display tropopause height and maximum wind / jet stream data from GFS GRIB2 forecasts. Tropopause data is already acquired and decoded; max wind requires a one-line acquisition change and minor decoder update. Both layers reuse the existing contour rendering infrastructure.

## Tropopause Height Contours

### Data Flow

Tropopause pressure is already acquired (`lev_tropopause=on`) and decoded into `gridded_fields` with `level_type='tropopause'`, `level_hpa=-1`, `parameter='PRES'`. Tropopause temperature (`parameter='TMP'`) is also stored for tooltip use.

Backend change needed: add an optional `level_type` query parameter to `/api/gridded` and include it in the WHERE clause. Both tropopause and max wind store data at `level_hpa=-1`, so `level_type` is required to disambiguate. Tropopause fetches pass `level_type=tropopause&level_hpa=-1`.

### Visualization

- **Thin dotted light blue contour lines** (new line style; all existing contours are solid)
- Pressure (Pa) converted to flight level: `FL = (1 - (P / 101325)^0.190284) * 145366.45 / 100`, rounded to nearest 10
- Contour interval: every 20 FL (FL260, FL280, FL300, FL320, etc.)
- Labels: "FL300", "FL320", etc. in light blue
- Deck.gl `PathLayer` with `getDashArray` + `PathStyleExtension({ dash: true })` for dotted lines + `TextLayer` for labels

### Interaction

- Click/hover on a tropopause contour shows a tooltip with both FL and temperature at that location
- Temperature data fetched alongside pressure and held in store for grid-point lookup
- Single "Trop" toggle button in toolbar

### Frontend Changes

- `appStore.ts`: `tropopauseVisible`, `tropopauseContours`, `tropopauseLoading`, `tropopauseError`, `tropopauseTempData` (raw temp grid for tooltip lookup). Tropopause fetch must use hardcoded `level_hpa=-1` and `level_type=tropopause`, not the operator-selected `selectedLevel`.
- `appStore.ts`: Update `setRunTime`, `setForecastHour`, and `setLevel` cache-invalidation blocks to null out `tropopauseContours` and `maxWindContours`/`maxWindBarbs`.
- `ContourLayer.ts`: New `createTropopauseLayers()` function
- `Toolbar.tsx`: "Trop" toggle button
- `MapView.tsx`: Conditionally render tropopause layers

## Max Wind / Jet Stream Display

### Data Flow (New)

- **Acquisition:** Add `"lev_max_wind=on"` to `LEVELS` array in `nomads.rs`
- **Decoder:** Add handling for fixed surface type 6 in `grib_decoder.py`, storing with `level_type='maxwind'`, `level_hpa=-1`
- This provides U, V, PRES, HGT, TMP at the max wind level

### Backend

New `/api/maxwind` endpoint:
- Fetches UGRD, VGRD, PRES at `level_type='maxwind'`
- Computes wind speed (kt) and direction from U/V
- Converts pressure to flight level
- Returns: `lats`, `lons`, `speeds`, `directions`, `flight_levels`

### Visualization — Two Overlaid Elements

**1. Isotach contours (wind speed):**
- Contour lines at 20kt intervals (per spec)
- Thicker lines at 80kt+ to highlight jet cores
- Dark green color (per spec color scheme)
- Labels: "80kt", "100kt", etc.

**2. Wind barbs (at grid points where speed >= 60kt):**
- Standard WMO wind barbs (half=5kt, full=10kt, pennant=50kt)
- Dark green to match isotach contours
- Thinned at lower zoom levels to avoid clutter (every 2nd or 3rd grid point)

### Interaction

- Click on a wind barb or isotach region shows: speed (kt), direction, flight level, and position
- Single "Jet" toggle button in toolbar

### Frontend Changes

- `appStore.ts`: `maxWindVisible`, `maxWindContours`, `maxWindBarbs`, `maxWindLoading`, `maxWindError`
- `ContourLayer.ts`: New `createMaxWindLayers()` — isotach `PathLayer` + `TextLayer`
- Max wind barb layer: generate a separate green-colored wind barb SVG atlas (the existing atlas is black/dark and `IconLayer` color tinting produces poor results on stroked SVGs). Filter to >= 60kt grid points.
- `Toolbar.tsx`: "Jet" toggle button
- `MapView.tsx`: Conditionally render max wind layers

## Changes by Service

| Service | File | Change |
|---------|------|--------|
| Acquisition | `nomads.rs` | Add `"lev_max_wind=on"` to `LEVELS` |
| Decoder | `grib_decoder.py` | Add surface type 6 handling → `level_type='maxwind'`, `level_hpa=-1` |
| Backend | `gridded.rs` | Add optional `level_type` query parameter to `/api/gridded` |
| Backend | New `maxwind.rs` | `/api/maxwind` endpoint: U/V/PRES → speed/direction/FL |
| Backend | `main.rs` | Register `/api/maxwind` route |
| Frontend | `appStore.ts` | Two new layer groups (tropopause + max wind) |
| Frontend | `ContourLayer.ts` | `createTropopauseLayers()` + `createMaxWindLayers()` |
| Frontend | `Toolbar.tsx` | "Trop" and "Jet" toggle buttons |
| Frontend | `MapView.tsx` | Conditionally render both new layer groups |

## Not in Scope

- Jet axis line extraction (hybrid isotach + barb approach is sufficient for now)
- Tropopause temperature as a separate contour layer (available on click/tooltip only)
- Cross-section display (separate iteration)
- ICAO standard atmosphere height (ICAHT) field — not required by spec

## Database

No migration needed. The `gridded_fields` schema already supports arbitrary `level_type` values via the existing `TEXT` column.
