# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project: Cirrus — WAFS Meteorological Workstation

A next-generation WAFS (World Area Forecast System) meteorological workstation that must pass the SADIS API Workstation Software Evaluation (9 pass/fail criteria). Competes with native C-based workstations — performance is a key differentiator.

## Architecture

Local service-oriented architecture — independent containerized services on a single host, orchestrated by Docker Compose. **Not** distributed microservices.

### Service Boundaries

| Service | Language | Role |
|---|---|---|
| **data-acquisition** | Rust (tokio, reqwest) | Polls SADIS/WIFS APIs, manages failover state machine, writes raw payloads |
| **decoding-engine** | Python 3.12+ (ecCodes, lxml, Shapely, avwx-engine) | Decodes GRIB2/BUFR → arrays, IWXXM → features, TAC → records |
| **backend-api** | Rust (Axum) | REST + WebSocket API, serves frontend, coordinates services |
| **frontend** | React 18 + TypeScript 5, Zustand, MapLibre GL JS + Deck.gl | Operator UI with WebGL map rendering |
| **alerting** | Rust | Monitors for advisory products, pushes alerts via WebSocket |
| **briefing** | Python + Playwright | Generates PDF flight documentation |
| **monitor** | Rust | Health checks all services, raises operational alerts |
| **postgres** | PostgreSQL 16 + PostGIS 3.4 + TimescaleDB | Single database for all data types |

### IPC Pattern

Services communicate via **PostgreSQL LISTEN/NOTIFY** and shared Docker volumes (for raw GRIB2/BUFR files). No message broker.

### Data Flow

```
SADIS/WIFS APIs → data-acquisition (Rust) → raw files on shared volume
                                          → NOTIFY decoding-engine
decoding-engine (Python) → decoded data in PostgreSQL → NOTIFY backend-api
backend-api (Rust/Axum) → REST/WebSocket → frontend (React/MapLibre/Deck.gl)
```

## Key Technical Constraints

- **Do NOT reimplement GRIB2/BUFR decoding.** Use ecCodes (ECMWF's C library) via Python bindings. The value is in integration and visualization.
- **GML coordinate order is lat,lon** — must convert to lon,lat for Shapely/GeoJSON.
- **SIGWX rendering is the hardest component** — scalloped CB boundaries, jet stream symbology, and compliance-critical rendering require the most engineering investment.
- **No API credentials yet** — use fixture data for early iterations.
- **System must work fully offline** after data is ingested — no runtime cloud dependencies.
- **Evaluation is pass/fail per criterion** — a single sub-requirement failure fails the entire criterion.

## Spec Documents (in `docs/`)

| File | Contents |
|---|---|
| `WAFS_Workstation_Technical_Specification.docx` | Core product spec (binary — use `textutil -convert txt` to read) |
| `WAFS_Technical_Specification_Addendum_A.md` | SWx, ASHTAM, alerting, ICAO areas |
| `WAFS_Implementation_Reference_Guide.md` | API patterns, data formats, decoding algorithms, rendering rules |
| `WAFS_Technical_Architecture.md` | Component design, data flows, technology justifications |
| `WAFS_Evaluation_Compliance_Matrix.md` | Criterion-by-criterion compliance checklist |
| `wafs_workstation_evaluation_summary.md` | Evaluator perspective and common failure modes |
| `WAFS-WS-SPEC-2026-001-B_METLAB2_Learnings.docx` | Learnings from an incumbent WAFS workstation with over 20 years in the field to help shape product design and implementation strategy (binary - use `textutil -convert txt` to read) |

## Development Approach

- **Thin vertical slices** — each iteration cuts the full stack for one narrow capability
- Every iteration produces a runnable artifact via `docker compose up`
- 12 iterations from scaffold to evaluation readiness (see memory for sequence)

## Build & Run

```bash
docker compose up        # Run the full stack
docker compose up -d     # Detached mode
docker compose build     # Rebuild all images
docker compose logs -f <service>  # Tail logs for a specific service
```

### Per-Service Development

**Rust services** (acquisition, backend-api, alerting, monitor):
```bash
cargo build              # Build
cargo test               # Run tests
cargo test <test_name>   # Run single test
cargo clippy             # Lint
cargo fmt --check        # Check formatting
```

**Python services** (decoding-engine, briefing):
```bash
python -m pytest         # Run tests
python -m pytest tests/test_foo.py::test_bar  # Single test
ruff check .             # Lint
ruff format --check .    # Check formatting
```

**Frontend**:
```bash
npm install              # Install dependencies
npm run dev              # Dev server
npm test                 # Run tests
npm run lint             # ESLint
npm run build            # Production build
```
