# ICAO Area Presets + Map Legend

**Date:** 2026-03-22
**Criteria:** 2a.6-7, 2b.11, 2c.8, 3a.8-9
**Status:** Approved

## Overview

Add two cross-cutting UI features: (1) an ICAO area selector dropdown with 13 named chart area presets that snap the map to predefined bounds, and (2) a persistent map legend overlay showing WAFC source, validity time, flight level, and active layers.

## ICAO Area Presets

### Data

13 predefined chart areas with bounding boxes (all Mercator projection for now — polar stereo J/K/M are approximated as Mercator bounds until polar projection support is added):

| Area | Name | Bounds [S, W, N, E] |
|------|------|---------------------|
| A | Americas | -55, -140, 70, -20 |
| B | Atlantic/Europe/Africa | -55, -60, 70, 70 |
| B1 | Americas/Atlantic/Europe | -55, -140, 70, 70 |
| C | W Pacific/E Asia | -55, 60, 70, 150 |
| D | E Pacific/Americas | -55, 100, 70, -170 (wraps IDL) |
| E | Europe/N Atlantic | 25, -70, 70, 50 |
| F | Pacific/E Asia | -30, 80, 40, 180 |
| G | Middle East/S Asia | -15, 20, 50, 90 |
| H | C Africa/Indian Ocean | -50, -10, 25, 70 |
| I | S Pacific/Australia | -55, 90, 10, -170 (wraps IDL) |
| J | S Polar (Pacific) | -90, -180, -25, 180 |
| K | S Polar (Indian) | -90, -180, -25, 180 |
| M | N Polar | 25, -180, 90, 180 |

### UI

- Dropdown in the toolbar (between Level selector and toggle buttons)
- Options: "Area" (default/no selection), then A, B, B1, C, D, E, F, G, H, I, J, K, M
- Selecting an area calls `mapFitBounds(south, west, north, east)` to snap the view
- Selecting "Area" (default) does nothing — returns to free navigation
- No store state needed — just a UI control that triggers mapFitBounds

## Map Legend

### Content

A semi-transparent overlay in the bottom-left corner of the map showing:

- **Line 1:** Data source — "GFS 0.25°" (placeholder until WAFS/SADIS integration)
- **Line 2:** Run time + valid time — e.g., "Run: 22 Mar 18Z | Valid: 23 Mar 00Z"
- **Line 3:** Flight level — e.g., "FL300 (300 hPa)"
- **Line 4:** Active layers — e.g., "Wind, Temp, Trop"

### Styling

- Position: bottom-left, above the status bar
- Background: semi-transparent dark (`rgba(22,33,62,0.85)`)
- Font: monospace, small (11-12px), light text
- Border: subtle 1px border
- Compact — no wasted space

### Data Source

Reads from existing store state: `dataRunTime`, `dataValidTime`, `dataForecastHour`, `selectedLevel`, and visibility flags for each layer.

## Changes

| File | Change |
|------|--------|
| Create: `src/components/IcaoAreaSelector.tsx` | Dropdown with 13 area presets, calls mapFitBounds |
| Create: `src/components/MapLegend.tsx` | Legend overlay component |
| Modify: `src/components/Toolbar.tsx` | Add IcaoAreaSelector between Level and Wind toggle |
| Modify: `src/components/map/MapView.tsx` | Add MapLegend overlay |
| Modify: `src/App.css` | Styles for legend overlay and area selector |

## Not in Scope

- Polar stereographic projection (J/K/M areas use Mercator approximation)
- WAFC attribution stripping on data modification (3a.10) — deferred to SIGWX iteration
- Print/briefing legend formatting (3b.2) — deferred to briefing iteration
