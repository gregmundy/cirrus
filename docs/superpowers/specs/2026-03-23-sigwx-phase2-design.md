# SIGWX Phase 2 — Advanced Rendering

**Date:** 2026-03-23
**Criterion:** 3a (SIGWX IWXXM Display)
**Status:** Approved

## Overview

Polish SIGWX rendering to match ICAO symbology standards. Frontend-only changes — no backend/decoder modifications. Applies to the existing `SigwxLayer.ts` and adds a new spline/geometry utility.

## 1. Cubic Spline Interpolation

New `splineInterpolation.ts` utility. Takes GML CubicSpline control points and returns densified smooth coordinates using natural cubic spline interpolation. Applied to:
- Jet stream curves (LineString)
- All polygon boundaries (turbulence, icing, cloud, tropopause)

Function signature: `interpolateSpline(points: [number, number][], segments?: number): [number, number][]`
- `points`: control points in [lon, lat] order
- `segments`: number of interpolated points between each control point pair (default: 10)

## 2. Scalloped CB Boundaries

New `generateScallopedRing(ring: [number, number][], scallopSize?: number): [number, number][]` function.

Replaces each edge segment with a semicircular arc bulging outward from the polygon. Parameters:
- `ring`: polygon ring coordinates [lon, lat]
- `scallopSize`: arc radius in degrees (default: ~1.5°, tuned visually)

Applied only to CLOUD features where `cloud_type_code === '9'` (CB/cumulonimbus). The scalloped ring replaces the outline PathLayer data. The fill SolidPolygonLayer keeps the original smooth boundary.

## 3. Turbulence Dashing

Use `PathStyleExtension({ dash: true })` with `getDashArray: [6, 4]` on the TURBULENCE PathLayer. Requires casting the PathLayer constructor (same pattern as tropopause contours in ContourLayer.ts).

## 4. Improved Labels

Severity labels from WMO codes:
- Turbulence (0-11-030): 8="MOD TURB", 10="SEV TURB", 12="EXTR TURB"
- Icing (0-20-041): 1="LGT ICE", 2="LGT ICE", 3="MOD ICE", 4="SEV ICE"
- Cloud distribution (0-20-008): 10="ISOL CB", 11="OCNL CB", 12="FRQ CB"

FL range format: "FL340/400" (slash separator per ICAO convention).

Label offsets per phenomenon type to reduce overlap:
- Turbulence: [0, 0] (centroid)
- Icing: [0, 5]
- Cloud: [0, -5]
- Tropopause: [0, 0]

## Files Changed

| File | Change |
|---|---|
| Create: `src/utils/splineInterpolation.ts` | `interpolateSpline()` + `generateScallopedRing()` |
| Modify: `src/components/map/SigwxLayer.ts` | Apply splines, scallops, dashing, improved labels |

## Not in Scope
- Time slider
- SIGWX data acquisition
- WAFC attribution stripping (3a.10)
- Zoom-dependent scallop sizing
- Label collision avoidance (constraint solver)
