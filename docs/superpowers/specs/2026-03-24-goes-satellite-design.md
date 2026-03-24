# GOES-16 Satellite Imagery

**Date:** 2026-03-24
**Status:** Approved

## Overview

Acquire, reproject, and render GOES-16 ABI satellite imagery (CONUS sector) on the map. Start with 3 key channels (Ch 2 Visible, Ch 8 Water Vapor, Ch 13 IR). Raw float data sent to frontend for WebGL rendering with color ramps. Auto-polls every 5 minutes matching GOES CONUS scan rate.

## Data Source

NOAA public S3 bucket `s3://noaa-goes16/` (anonymous access, no credentials).
- Product: `ABI-L2-CMIPC` (Cloud and Moisture Imagery — CONUS)
- Format: NetCDF4, ~5-15 MB per channel per scan
- Update rate: every 5 minutes
- Channels: 2 (0.64µm Visible), 8 (6.2µm Upper WV), 13 (10.3µm Clean IR)

## Architecture

### Acquisition + Processing (Python — decoder service)

- `satellite_acquire.py`: Poll S3 with `boto3` (anonymous), download latest NetCDF4 for channels 2, 8, 13 to `/data/satellite/`
- `satellite_process.py`: Read NetCDF4, convert GOES fixed-grid projection to equirectangular lat/lon grid using satellite perspective math. Output: float32 array on regular grid covering CONUS (~24°N-50°N, 125°W-66°W). Write processed data as JSON to shared volume.
- `satellite_main.py`: Polling loop — acquire + process + write, every 5 minutes. Runs as a separate process or thread within the decoder container.

### Backend (Rust — Axum)

- `satellite.rs`: `GET /api/satellite/{channel}` — reads processed JSON file from shared volume, serves to frontend. Response shape: `{ channel, timestamp, ni, nj, lat_first, lon_first, d_lat, d_lon, values: [f32] }`

### Frontend (React — Deck.gl)

- `SatelliteLayer.ts`: Takes float grid + color ramp, generates RGBA ImageData, renders as `BitmapLayer` with geographic bounds.
- Color ramps: Ch 2 greyscale, Ch 8 blue-green-yellow-red, Ch 13 inverted greyscale
- Store: `satelliteChannel`, `satelliteVisible`, `satelliteData`, `satelliteLoading`
- Toolbar: Satellite toggle + channel dropdown (Vis/WV/IR)
- Layer rendered below all other layers (base imagery)

## Files

| Service | File | Change |
|---|---|---|
| Decoder | `satellite_acquire.py` (new) | S3 polling + download |
| Decoder | `satellite_process.py` (new) | NetCDF4 → lat/lon grid |
| Decoder | `satellite_main.py` (new) | Polling loop |
| Backend | `satellite.rs` (new) | `/api/satellite/{channel}` |
| Backend | `main.rs` | Register route |
| Frontend | `SatelliteLayer.ts` (new) | Color-ramped BitmapLayer |
| Frontend | `appStore.ts` | Satellite state |
| Frontend | `Toolbar.tsx` | Toggle + channel selector |
| Frontend | `MapView.tsx` | Wire in layer |
| Docker | `docker-compose.yml` | Shared volume for satellite data |

## Not in Scope
- Full Disk sector (CONUS only for now)
- Channels beyond 2, 8, 13
- User-configurable color ramps / brightness / contrast
- Animation / looping
- GOES-18 (West)
