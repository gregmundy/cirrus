# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project: Cirrus — Comprehensive Weather Workstation

A weather workstation for aviation and operational meteorology. Cirrus ingests gridded NWP output, satellite imagery, station observations, and forecast advisories, decodes them locally, and renders the result as an interactive WebGL workstation. Designed to run fully offline post-ingest. Competes with native C-based incumbents — performance, rendering fidelity, and modern UX are intentional differentiators.

## Architecture

Local service-oriented architecture — independent containerized services on a single host, orchestrated by Docker Compose. **Not** distributed microservices.

### Service Boundaries

| Service | Language | Role |
|---|---|---|
| **acquisition** | Rust (tokio, reqwest) | Polls NOMADS GFS, AWC METAR/TAF/SIGMET, NOAA GOES; tracks download state; writes raw payloads to shared volumes |
| **decoder** | Python 3.12+ (ecCodes, lxml, Shapely) | Decodes GRIB2 → gridded fields, IWXXM XML and BUFR → SIGWX features, GOES NetCDF → reprojected imagery |
| **backend** | Rust (Axum) | REST API serving decoded data and imagery to the frontend |
| **frontend** | React 18 + TypeScript, Zustand, MapLibre GL + Deck.gl | Operator workstation UI. Optionally packaged as a desktop app via **Tauri** (`services/frontend/src-tauri/`). |
| **alerting** | Rust | Will monitor for advisory products and push WebSocket alerts *(scaffold)* |
| **briefing** | Python + Playwright | Will generate PDF flight documentation *(scaffold)* |
| **monitor** | Rust | Will run service health checks *(scaffold)* |
| **postgres** | PostgreSQL 16 + PostGIS 3.4 + TimescaleDB | Single database for all data types |

### IPC Pattern

Services communicate via **PostgreSQL `LISTEN`/`NOTIFY`** plus shared Docker volumes (raw GRIB2, BUFR, IWXXM, GOES NetCDF). No message broker.

### Data Flow

```
upstream providers  →  acquisition  →  raw payloads on shared volume  +  NOTIFY decoder
                                                                              ↓
                                       decoder  →  PostgreSQL  →  NOTIFY backend
                                                                              ↓
                                       backend  →  REST  →  frontend (MapLibre + Deck.gl)
```

### Backend API surface

`/api/wind`, `/api/gridded`, `/api/gridded/meta`, `/api/maxwind`, `/api/sigwx`, `/api/opmet/stations`, `/api/opmet/text`, `/api/satellite/{channel}`. See README for details.

## Key Technical Constraints

- **Do NOT reimplement GRIB2/BUFR decoding.** Use ecCodes (ECMWF's C library) via Python bindings. The value is in integration and visualization, not format work.
- **GML coordinate order is lat,lon** — must convert to lon,lat for Shapely/GeoJSON.
- **System must work fully offline** after data is ingested — no runtime cloud dependencies.
- **All upstream providers today are public/unauthenticated.** Credential-leakage risks (URL logging in `acquisition/nomads.rs`, full-URL persistence in `acquisition/db.rs`) must be remediated before wiring any authenticated upstream. See README "Caveats" section.

## Specification Corpus (in `docs/`)

The `docs/` directory holds detailed technical specifications, architectural notes, decoding algorithms, validation procedures, and product-design references. They are authoritative for product requirements. Several `.docx` files are binary — read them with `textutil -convert txt <file>`.

## Development Approach

- **Thin vertical slices** — each iteration cuts the full stack for one narrow capability and produces a runnable artifact via `docker compose up`.
- See README "Roadmap" for the completed slices and the next-up list.

## Build & Run

```bash
docker compose up        # Run the full stack
docker compose up -d     # Detached
docker compose build     # Rebuild all images
docker compose logs -f <service>
```

When migrations change, drop the `cirrus_pgdata` volume so `docker-entrypoint-initdb.d` re-runs migrations on a fresh DB.

### Per-Service Development

**Rust services** (workspace root at `services/`):
```bash
cd services
cargo build              # Build all workspace crates
cargo test               # Run all tests
cargo test -p backend    # Run tests for one crate
cargo clippy             # Lint
cargo fmt --check        # Check formatting
```

**Python services** (each in `services/<name>/`, e.g. `services/decoder/`):
```bash
cd services/decoder
pip install -e ".[decode]"          # Install in dev mode
python -m pytest                    # Run tests
python -m pytest tests/test_foo.py  # Single test file
ruff check .
ruff format --check .
```

**Frontend** (in `services/frontend/`):
```bash
cd services/frontend
npm install              # Install dependencies
npm run dev              # Dev server with hot reload
npm test
npm run lint
npm run build            # Production build (bundle for Docker / Tauri)
```

**Tauri desktop wrapper** (in `services/frontend/src-tauri/`):
```bash
cd services/frontend
npm run tauri dev        # Run as native desktop app in dev mode
npm run tauri build      # Produce a signed installer
```
