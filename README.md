# Cirrus

A comprehensive web-first meteorological workstation. Ingests gridded numerical-weather-prediction output, satellite imagery, station observations, and forecast advisories, decodes them locally, and renders the result as an interactive WebGL workstation — running fully offline post-ingest.

## Why build a meteorological workstation

I spent a significant portion of my career working in weather, first as a
consultant for NOAA and NASA initiatives, then supporting the commercial
weather products division of one of my earlier employers. I developed a
passion for weather, especially aviation meteorology, and needed an outlet
for the knowledge I earned over many years.

Cirrus is the means by which I scratch this itch. It allows me to maintain my footing

![Cirrus App](screenshots/satellite_2.png)

## Architecture

Local service-oriented architecture: independent containerized services on a single host, orchestrated by Docker Compose. **Not** distributed microservices.

| Service | Language | Role |
|---|---|---|
| `acquisition` | Rust (tokio, reqwest) | Polls upstream providers (NOMADS GFS, AWC METAR/TAF/SIGMET, NOAA GOES), tracks download state, writes raw payloads |
| `decoder` | Python 3.12 + ecCodes | Decodes GRIB2 → gridded fields, IWXXM XML and BUFR → SIGWX features, GOES NetCDF → reprojected imagery |
| `backend` | Rust (Axum) | REST API serving decoded fields and imagery to the frontend |
| `frontend` | React 18 + TypeScript + MapLibre GL + Deck.gl | Operator workstation UI with WebGL map rendering. Optionally packaged as a desktop app via **Tauri**. |
| `alerting` | Rust | Will monitor for advisory products and push WebSocket alerts *(scaffold)* |
| `briefing` | Python + Playwright | Will generate PDF flight documentation *(scaffold)* |
| `monitor` | Rust | Will run service health checks *(scaffold)* |
| `postgres` | PostgreSQL 16 + PostGIS 3.4 + TimescaleDB | Single database for all data types |

Inter-service IPC is **PostgreSQL `LISTEN`/`NOTIFY`** plus shared Docker volumes for raw payloads. No message broker.

```
upstream providers  →  acquisition  →  /data/grib + /data/satellite  +  NOTIFY decoder
                                                                          ↓
                                       decoder  →  PostgreSQL  →  NOTIFY backend
                                                                          ↓
                                       backend  →  REST  →  frontend (MapLibre + Deck.gl)
```

## Getting started

### Prerequisites

- **Docker Engine 25+** with Compose v2 (the `docker compose` plugin, not `docker-compose`). Docker Desktop is fine.
- **~10 GB free disk** for images and the GRIB store. Each GFS forecast hour is ~50 MB and the default retention is 48 h.
- **~4 GB free RAM** to run the whole stack comfortably.
- **Outbound network access** to NOMADS (`nomads.ncep.noaa.gov`) and the AWC (`aviationweather.gov`). No credentials required for any current upstream.
- macOS, Linux, or Windows + WSL2. The Postgres image is pinned to support ARM64 (Apple Silicon) natively.

### Initial setup

```bash
git clone git@github.com:gregmundy/cirrus.git
cd cirrus
cp .env.example .env             # default password is "cirrus_dev" — rotate before any non-local deploy
docker compose up --build
```

The first build pulls Rust + Python + Node images and compiles the workspace. Plan for **5–10 minutes** on the first build; subsequent `docker compose up` calls reuse cached layers and are much faster. The build produces no output until each layer finishes — it is not frozen.

When all services report healthy, the operator UI is at **http://localhost:3000** and the backend at **http://localhost:8080**.

### What happens on first boot

The acquisition service kicks its three polling loops as soon as Postgres is healthy:

1. **GFS GRIB2** — finds the most recent available cycle (NOAA's availability offset is ~5 hours after the cycle hour) and downloads the configured forecast hours. ~600 MB per cycle. The decoder ingests each file as it lands.
2. **METARs** — pulls the AWC `metars.cache.csv` (typically thousands of stations) and stores fresh observations in `opmet_reports`.
3. **TAFs + SIGMETs** — pulls AWC's TAF and international SIGMET feeds into `opmet_text_reports`.

In the first 1–2 minutes you should see ~12 forecast hours decoded, hundreds of TAFs ingested, and dozens of SIGMETs. The frontend serves immediately, but layers light up only after the relevant data lands — be patient on the first cycle.

### Verifying the stack

```bash
docker compose ps                                    # All 8 services should be (healthy)
curl http://localhost:8080/health                    # → {"service":"backend","status":"ok"}
curl http://localhost:8080/api/gridded/meta          # → JSON listing available runs/levels/parameters

# Watch the pipeline in real time
docker compose logs -f acquisition
docker compose logs -f decoder
```

The `frontend` container is currently flagged "unhealthy" by Docker even when working — its healthcheck uses `wget --spider` which is not in the `nginx:alpine` image. Cosmetic only; if `curl http://localhost:3000` returns 200, the SPA is up.

### Loading SIGWX features (manual, on-demand)

SIGWX is **not** auto-ingested today. The decoder ships a CLI loader that accepts WAFS IWXXM XML or BUFR files. Sample fixtures are bundled at `services/decoder/fixtures/`:

```bash
# Load the bundled WAFS IWXXM XML example
docker compose exec decoder python -m cirrus.decoder.sigwx_load \
    fixtures/WAFS-Example.xml

# Load the bundled BUFR sample
docker compose exec decoder python -m cirrus.decoder.sigwx_load \
    fixtures/sigwx_bufr_sample.bufr

# Or your own file (mount it into the container or copy first)
docker compose cp /path/to/file.xml decoder:/tmp/file.xml
docker compose exec decoder python -m cirrus.decoder.sigwx_load /tmp/file.xml
```

Until you load at least one file, `GET /api/sigwx` returns 404 and the frontend SIGWX layer stays empty.

### GOES satellite imagery

GOES-19 imagery is pulled automatically from the public NOAA S3 bucket `noaa-goes19` (anonymous access — no AWS credentials needed). The decoder spawns a polling thread on startup that downloads the latest CONUS sector ABI L2 Cloud and Moisture Imagery for three channels (visible, upper water-vapor, clean IR), reprojects each to equirectangular lat/lon at 1800×1000, and writes JSON files to `/data/satellite/ch{NN}.json` on the `satellite_store` volume. The backend reads those files at request time and serves them via `GET /api/satellite/{channel}`.

Tunable via env vars:
- `SATELLITE_POLL_INTERVAL_SECS` (default `600`) — how often to refresh.
- `SATELLITE_DATA_DIR` (default `/data/satellite`) — where to write JSONs.

The first poll takes ~45 s (download + reproject all three channels) — `/api/satellite/{channel}` returns 404 until it completes.

### Iterating on code

| Change | Command |
|---|---|
| Edited Rust or Python source | `docker compose up --build <service>` (or `docker compose up --build` for all) |
| Added or modified a SQL migration in `db/migrations/` | `docker volume rm cirrus_pgdata && docker compose up --build` — migrations only run on a fresh DB |
| Edited frontend | `docker compose up --build frontend` for a containerized rebuild, or `cd services/frontend && npm run dev` for hot reload (proxied to the running backend on :8080) |

### Stopping and cleanup

```bash
docker compose down                                  # Stop services, keep volumes (data persists)
docker compose down -v                               # Stop services AND drop pgdata + grib_store (full reset)
docker volume rm cirrus_pgdata cirrus_grib_store     # Drop volumes explicitly without stopping
```

### Troubleshooting

- **`/api/sigwx` always returns 404** — expected until you run the SIGWX CLI loader (see above). It is not auto-ingested.
- **`/api/maxwind` is empty for the first cycle** — the GFS subset must include the max-wind level (`max_wind` / surface type 6). Check `acquisition` logs for download progress.
- **Decoder logs show "deadlock" warnings** — there is a known LISTEN/NOTIFY pattern that uses separate connections; if you see a hang, restart the decoder container. The fix landed in commit `80ddcc4`.
- **Migrations did not apply after a code pull** — Postgres only runs `docker-entrypoint-initdb.d` on a fresh data directory. Drop the `cirrus_pgdata` volume.
- **First build seems to hang** — `docker compose build` produces little output between layers. Check `docker stats` for activity. The Rust workspace alone takes 3–5 minutes on a clean cache.
- **Acquisition cannot reach upstreams** — verify the host has outbound HTTPS to `nomads.ncep.noaa.gov` and `aviationweather.gov`. Corporate proxies typically require `HTTPS_PROXY` env passthrough.

Per-service development commands (`cargo build`, `npm run dev`, `pytest`, etc.) are documented in `CLAUDE.md`.

## What's built

### Data pipelines

| Source | Cadence | Decoded into | Tables |
|---|---|---|---|
| **NOMADS GFS** GRIB2 (0.25°) | auto-poll, per cycle | UGRD/VGRD, TMP, HGT, RH, max-wind, tropopause | `grib_downloads`, `gridded_fields` |
| **AWC METAR** cache CSV | auto-poll | Station observations with flight category | `aerodromes`, `opmet_reports` |
| **AWC TAF + SIGMET** | auto-poll | OPMET text products | `opmet_text_reports` |
| **WAFS SIGWX** IWXXM XML and BUFR | manual via CLI loader | 9 phenomenon types (CB, turbulence, jets, icing, volcanic ash, etc.) | `sigwx_features` |
| **NOAA GOES-19** (East) — public S3 bucket `noaa-goes19` | auto-poll (default 600 s) | Visible (Ch2), Upper WV (Ch8), Clean IR (Ch13) reprojected to equirectangular | flat-file JSON store on `satellite_store` volume |

### Backend API (`services/backend`)

| Endpoint | Returns |
|---|---|
| `GET /api/gridded/meta` | Available runs, forecast hours, parameters, isobaric levels |
| `GET /api/gridded` | Generic gridded field by `run_time / forecast_hour / level / parameter` (optional `level_type` filter) |
| `GET /api/wind` | Paired U/V components with server-side thinning |
| `GET /api/maxwind` | Jet-stream level data for isotach contouring |
| `GET /api/sigwx` | Significant-weather features in a valid-time window |
| `GET /api/opmet/stations` | Latest METARs with flight category |
| `GET /api/opmet/text` | TAF / SIGMET text by ICAO + product type |
| `GET /api/satellite/{channel}` | Latest GOES image by channel |

### Frontend (`services/frontend`)

**Workstation UI** — header bar, layer panel, data panel, status bar, ICAO area selector, map legend, station-detail popup, OPMET text panel. The earlier ad-hoc toolbar was replaced with a proper workstation layout.

**Map layers** (Deck.gl over a MapLibre basemap):
- **Wind barbs** — runtime SVG sprite atlas, meteorologically correct rotation, hover tooltip with speed (kt) / direction / position. A separate dark-green atlas is used for jet-stream barbs.
- **Temperature, height, RH contours** — computed in a Web Worker via `d3-contour` with Gaussian smoothing. **H/L extrema detection** with proximity dedup and value labels.
- **Tropopause + max wind** — isotach contour layer for jet-stream display.
- **SIGWX (significant weather)** — ICAO chart-style rendering with splines, scalloped CB boundaries, dashed boundaries, official WMO/ICAO SVG sprite atlas, and zoom-responsive symbols and labels. Renders all 9 phenomenon types.
- **Station observations** — WMO station model with cloud cover, wind barbs, sea-level pressure, and zoom scaling. Flight-category color coding.
- **GOES satellite imagery** — bilinear reprojection, semi-transparent overlay tuned for coastline visibility.

**Geographic helpers** — Go To location (center+zoom or fit-bounds), ICAO area presets, map legend overlay.

**Desktop packaging** — `services/frontend/src-tauri/` contains a Tauri wrapper for shipping the UI as a native desktop app.

### Database (`db/migrations/`)
Six migrations: `001_init.sql`, `002_gridded_data.sql`, `003_opmet_data.sql`, `004_add_slp.sql`, `005_sigwx_features.sql`, `006_opmet_text.sql`. TimescaleDB hypertable for `gridded_fields`. PostGIS used for SIGWX feature geometry. Aerodrome metadata seeded from OurAirports.

### Working stack
All 8 services come up cleanly under `docker compose up`. Health checks pass; `nginx` proxies `/api/*` to the backend so the SPA and API run on a single origin. End-to-end verified: a fresh `up` ingests one GFS cycle plus several hundred TAFs and SIGMETs within the first poll loop.

## Caveats and known limitations

### Latent credential-leakage risks (must fix before integrating any authenticated upstream)
A pre-LaCie security audit (May 2026) flagged two patterns that are safe **today** because all current upstreams are public, but will leak credentials the moment any authenticated provider is wired in:
- `services/acquisition/src/nomads.rs` logs the **full upstream URL** on every retry/error. Add a `redact_url()` helper before wiring auth.
- `services/acquisition/src/db.rs` **persists the full URL** in `grib_downloads.source_url`. Strip query string before insert.

### Deployment hardening (before any non-localhost deploy)
- Backend binds `0.0.0.0:8080` with **no authentication** — fine for single-host on-prem, risky on a hostile network.
- No security headers on Axum responses or the frontend's nginx config (no CSP, `X-Frame-Options`, `nosniff`).
- All container images run as **root** — no `USER` directives in any Dockerfile.
- Compose passes secrets via `environment:` rather than Docker `secrets:` blocks.
- `.gitignore` covers bare `.env` only; should widen to `.env*` plus key/cert globs.

### Functional gaps
- **SIGWX is not auto-ingested** — features land in the DB only when an operator runs the CLI loader against a WAFS XML or BUFR file.
- **No WebSocket push channel yet** — `alerting` is a scaffold; advisory delivery is still poll-based via REST.
- **No PDF briefing output** — `briefing` is a scaffold; Playwright integration is future work.
- **No auth, no user accounts, no session management.**
- **No multi-provider failover state machine** — acquisition has retry-with-backoff per provider, but no orchestrated primary/fallback yet.
- **SIGWX BUFR parsing is fixture-tested only** — it has unit coverage against an NWS sample but has not yet been exercised against a live BUFR stream.
- Backend handlers map sqlx errors to bare 500s **without server-side logging**, so DB failures are operationally invisible.

## Roadmap

The completed slices:

1. ✅ Stack scaffold + healthchecks
2. ✅ GFS acquisition pipeline (NOMADS)
3. ✅ GRIB2 decoder + storage
4. ✅ Wind barb visualization (end-to-end)
5. ✅ Temperature / height / RH contours with H/L extrema
6. ✅ Tropopause + max wind / jet-stream display
7. ✅ Station observations (METAR) with WMO station model
8. ✅ OPMET text products (TAF + SIGMET)
9. ✅ SIGWX rendering — IWXXM XML and BUFR, ICAO-standard symbology, scalloped CB, splines
10. ✅ GOES-19 satellite imagery (visible, upper WV, clean IR) — auto-poll from public NOAA S3 bucket
11. ✅ Workstation UI (header + layer panel + data panel + map legend)
12. ✅ Tauri desktop wrapper

Next up:

- **Auto-ingest for SIGWX** — wrap the existing CLI loader behind an acquisition polling loop or NOTIFY-driven trigger so SIGWX populates without manual operator action.
- **Alerting WebSocket channel** — push advisory products to the frontend in near-real-time (currently the `alerting` service is a scaffold).
- **PDF briefing output** — wire up Playwright to render briefing packets from the same data the UI sees.
- **Multi-provider acquisition** with primary/fallback failover, gated on credentials for authenticated upstreams.
- **Live BUFR ingest path** for SIGWX (the parser exists; the acquisition+notify wiring does not).
- **Security hardening pass** — `tower_http` security-header layer, nginx CSP, non-root containers, Docker `secrets:` blocks, URL redaction in acquisition logs.
- **Observability** — structured logging, error reporting from backend handlers, container metrics for `monitor`.
- **Compliance and conformance hardening** against published reference standards.
- **Test coverage** — integration tests for the full acquisition→decoder→backend path; visual regression for SIGWX and station-model rendering.

## Repository layout

```
cirrus/
├── docker-compose.yml          # 8-service stack
├── .env.example                # Environment template (rotate password before non-local)
├── db/
│   ├── Dockerfile              # Postgres 16 + PostGIS + TimescaleDB image
│   └── migrations/             # 001 → 006, run by postgres entrypoint
├── services/
│   ├── Cargo.toml              # Rust workspace
│   ├── Dockerfile.rust         # Shared multi-stage Dockerfile (parameterized by SERVICE arg)
│   ├── acquisition/            # GFS poller, METAR/TAF/SIGMET ingest, GOES fetcher
│   ├── backend/                # Axum REST API (wind, gridded, maxwind, sigwx, opmet, satellite)
│   ├── alerting/               # Scaffold
│   ├── monitor/                # Scaffold
│   ├── decoder/                # GRIB2 + IWXXM XML + SIGWX BUFR + GOES NetCDF
│   ├── briefing/               # Scaffold
│   └── frontend/
│       ├── src/                # React + MapLibre + Deck.gl workstation UI
│       └── src-tauri/          # Tauri desktop wrapper
└── docs/                       # Spec corpus + validation guide
```

## Contributing

See `CLAUDE.md` for conventions, build/test commands, and the canonical service-name vocabulary. Spec docs in `docs/` are authoritative for product requirements.
