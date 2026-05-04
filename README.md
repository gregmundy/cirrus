# Cirrus

A next-generation **comprehensive weather workstation** for aviation and operational meteorology. Cirrus ingests gridded numerical-weather-prediction output, decodes it locally, and visualizes it on a high-performance interactive map.

The product competes with native C-based incumbents that have been in the field for 20+ years — performance and rendering fidelity are intentional differentiators.

## Architecture

Local service-oriented architecture: independent containerized services on a single host, orchestrated by Docker Compose. **Not** distributed microservices — designed to run fully offline post-ingest.

| Service | Language | Role |
|---|---|---|
| `acquisition` | Rust (tokio, reqwest) | Polls upstream forecast providers, manages download state, writes raw payloads |
| `decoder` | Python 3.12 + ecCodes | Decodes GRIB2 (and eventually BUFR and other meteorological formats) into typed records |
| `backend` | Rust (Axum) | REST API serving decoded fields to the frontend |
| `frontend` | React 18 + TypeScript + MapLibre GL + Deck.gl | Operator UI, WebGL map rendering |
| `alerting` | Rust | Will monitor for advisory products and push WebSocket alerts *(scaffold only)* |
| `briefing` | Python + Playwright | Will generate PDF flight documentation *(scaffold only)* |
| `monitor` | Rust | Will run service health checks *(scaffold only)* |
| `postgres` | PostgreSQL 16 + PostGIS 3.4 + TimescaleDB | Single database for all data types |

Inter-service IPC is **PostgreSQL `LISTEN`/`NOTIFY`** plus a shared Docker volume for raw GRIB2 files. No message broker.

```
forecast provider  →  acquisition  →  /data/grib  +  NOTIFY decoder
                                                       ↓
                                 decoder  →  PostgreSQL  →  NOTIFY backend
                                                       ↓
                                 backend  →  REST  →  frontend (MapLibre + Deck.gl)
```

## Quick start

```bash
cp .env.example .env             # edit POSTGRES_PASSWORD before any non-local use
docker compose up                # bring up the full stack
open http://localhost:3000       # operator UI
```

The backend is at `http://localhost:8080` (`/health`, `/api/wind`, `/api/gridded`, `/api/gridded/meta`).

Per-service development commands (`cargo build`, `npm run dev`, `pytest`, etc.) are documented in `CLAUDE.md`.

## What's built

### End-to-end GFS pipeline
- `acquisition` polls **NOMADS** (NOAA's GFS distribution endpoint) on a configurable interval, detects newly available cycles based on the GFS availability offset, downloads the GRIB2 subset, and tracks state in `grib_downloads` with retention-based cleanup.
- `decoder` listens for `NOTIFY new_download`, decodes each GRIB2 message via **ecCodes**, and writes typed gridded fields to the `gridded_fields` table (UGRD/VGRD wind components, TMP temperature, HGT geopotential height, etc.).
- `backend` exposes the decoded fields as JSON:
  - `GET /api/gridded/meta` — available runs, forecast hours, and pressure levels
  - `GET /api/gridded?run_time=…&forecast_hour=…&level=…&parameter=…` — generic gridded field access
  - `GET /api/wind?...&thin=N` — paired U/V components with server-side thinning for barb display

### Operator UI
- **Full-viewport MapLibre map** with Carto Voyager basemap (tuned for chart-like contrast).
- **Wind barbs** — runtime-generated SVG sprite atlas rendered through a Deck.gl IconLayer; meteorologically correct rotation with the staff tail pointing toward the wind source. Hover tooltip shows speed (kt), direction, and position.
- **Temperature and height contours** computed in the browser via `d3-contour`, with **H/L extrema detection** (proximity-deduplicated) and value labels.
- **Toolbar controls** for run cycle, forecast hour (with valid-time labels), pressure level (rendered as flight levels — FL050…FL600), and per-layer toggles (Wind / Temp / Height).
- **Go To location** widget supporting both `center+zoom` and `fit-bounds` modes.
- Status bar with current selection summary.

### Database
- TimescaleDB hypertable for `gridded_fields` keyed by `(run_time, forecast_hour, level, parameter)`.
- PostGIS available for upcoming feature-based products (significant-weather charts, advisories).
- Migrations live in `db/migrations/` and run automatically via the Postgres init script entrypoint.

### Working stack
All 8 services come up cleanly under `docker compose up`. Health checks pass. The frontend nginx config proxies `/api/` to the backend, so the SPA and API run on a single origin.

## Caveats and known limitations

### Latent credential-leakage risks (must fix before integrating any authenticated upstream)
A security audit (May 2026) flagged two patterns that are safe **today** because the only upstream is unauthenticated NOMADS, but will leak credentials the moment any authenticated provider is wired in:
- `services/acquisition/src/nomads.rs` logs the **full upstream URL** on every retry/error. Add a `redact_url()` helper before wiring auth.
- `services/acquisition/src/db.rs` **persists the full URL** in `grib_downloads.source_url`. Strip query string before insert.

### Deployment hardening (before any non-localhost deploy)
- Backend binds `0.0.0.0:8080` with **no authentication** — fine for single-host on-prem, risky if the host sits on a hostile network.
- No security headers on Axum responses or in the frontend's nginx config (no CSP, no `X-Frame-Options`, no `nosniff`).
- All container images run as **root** — no `USER` directives in any Dockerfile.
- Compose passes secrets via `environment:` rather than Docker `secrets:` blocks (`*_FILE` variants).
- `.gitignore` covers bare `.env` only; should be widened to `.env*` plus key/cert globs.

### Functional gaps
- **Single upstream provider** — only NOMADS GFS today. Additional providers and authenticated endpoints are gated on credentials.
- **No significant-weather (SIGWX) rendering** — scalloped cumulonimbus boundaries, jet-stream symbology, and turbulence/icing graphics are not yet started; this is the largest remaining engineering investment.
- **GRIB2 only** — `decoder` does not yet handle BUFR or text-encoded products (SIGMET, AIRMET, METAR, TAF, etc.).
- **No WebSocket** — alerting service is a scaffold; the alert-push channel doesn't exist yet.
- **No auth, no user accounts, no session management.**
- **No PDF briefing output** — `briefing` service is a scaffold; Playwright integration is future work.
- **No failover state machine** — acquisition has retry-with-backoff but no primary/fallback provider orchestration yet.
- Backend handlers map sqlx errors to bare 500s **without server-side logging**, so DB failures are operationally invisible.

### Specification corpus
- Detailed technical specifications, architectural notes, and product-design references live in `docs/`. They are authoritative for product requirements.

## Roadmap

The development plan is **12 thin vertical slices** — each slice cuts the full stack for one narrow capability and produces a runnable artifact. Rough sequence:

1. ✅ Stack scaffold + healthchecks
2. ✅ GFS acquisition pipeline (NOMADS)
3. ✅ GRIB2 decoder + storage
4. ✅ Wind barb visualization (end-to-end)
5. ✅ Temperature + height contours with H/L extrema
6. **Next:** Multi-provider acquisition with primary/fallback failover (depends on credentials)
7. Significant-weather chart rendering — scalloped CB boundaries, jet-stream symbology *(largest engineering investment)*
8. BUFR and text-product decoding for SIGMET/AIRMET, volcanic-ash, space-weather advisories
9. Alerting service: WebSocket push of advisory products
10. PDF briefing generation via Playwright
11. Compliance and conformance hardening against published reference standards
12. Polish: performance tuning, security headers, auth, deployment hardening

### Cross-cutting work that touches multiple slices
- **Security hardening:** `tower_http` security-header layer, nginx CSP, non-root containers, Docker `secrets:` blocks, URL redaction in acquisition logs.
- **Observability:** structured logging, error reporting from backend handlers, container metrics for `monitor`.
- **Test coverage:** integration tests for the full acquisition→decoder→backend path; visual regression for significant-weather rendering once it lands.

## Repository layout

```
cirrus/
├── docker-compose.yml          # 8-service stack
├── .env.example                # Environment template (rotate password before non-local)
├── db/
│   ├── Dockerfile              # Postgres 16 + PostGIS + TimescaleDB image
│   └── migrations/             # SQL run by postgres entrypoint
├── services/
│   ├── Cargo.toml              # Rust workspace
│   ├── Dockerfile.rust         # Shared multi-stage Dockerfile (parameterized by SERVICE arg)
│   ├── acquisition/            # NOMADS poller, retention, NOTIFY producer
│   ├── backend/                # Axum REST API
│   ├── alerting/               # Scaffold
│   ├── monitor/                # Scaffold
│   ├── decoder/                # Python ecCodes-based GRIB2 decoder
│   ├── briefing/               # Scaffold
│   └── frontend/               # React + MapLibre + Deck.gl
└── docs/                       # Spec corpus (binary .docx + .md)
```

## Contributing

See `CLAUDE.md` for conventions, build/test commands, and the canonical service-name vocabulary. Spec docs in `docs/` are authoritative for product requirements.
