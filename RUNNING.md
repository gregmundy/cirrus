# Running Cirrus

Operational guide for setting up, running, and developing Cirrus. For an overview of what Cirrus is, see the main [README](README.md).

## Prerequisites

- **Docker Engine 25+** with Compose v2 (the `docker compose` plugin, not `docker-compose`). Docker Desktop is fine.
- **~10 GB free disk** for images and the GRIB store. Each GFS forecast hour is ~50 MB and the default retention is 48 h.
- **~4 GB free RAM** to run the whole stack comfortably.
- **Outbound network access** to NOMADS (`nomads.ncep.noaa.gov`) and the AWC (`aviationweather.gov`). No credentials required for any current upstream.
- macOS, Linux, or Windows + WSL2. The Postgres image is pinned to support ARM64 (Apple Silicon) natively.

## Initial setup

```bash
git clone git@github.com:gregmundy/cirrus.git
cd cirrus
cp .env.example .env             # default password is "cirrus_dev" — rotate before any non-local deploy
docker compose up --build
```

The first build pulls Rust + Python + Node images and compiles the workspace. Plan for **5–10 minutes** on the first build; subsequent `docker compose up` calls reuse cached layers and are much faster. The build produces no output until each layer finishes — it is not frozen.

When all services report healthy, the operator UI is at **http://localhost:3000** and the backend at **http://localhost:8080**.

## What happens on first boot

The acquisition service kicks its three polling loops as soon as Postgres is healthy:

1. **GFS GRIB2** — finds the most recent available cycle (NOAA's availability offset is ~5 hours after the cycle hour) and downloads the configured forecast hours. ~600 MB per cycle. The decoder ingests each file as it lands.
2. **METARs** — pulls the AWC `metars.cache.csv` (typically thousands of stations) and stores fresh observations in `opmet_reports`.
3. **TAFs + SIGMETs** — pulls AWC's TAF and international SIGMET feeds into `opmet_text_reports`.

In the first 1–2 minutes you should see ~12 forecast hours decoded, hundreds of TAFs ingested, and dozens of SIGMETs. The frontend serves immediately, but layers light up only after the relevant data lands — be patient on the first cycle.

## Verifying the stack

```bash
docker compose ps                                    # All 8 services should be (healthy)
curl http://localhost:8080/health                    # → {"service":"backend","status":"ok"}
curl http://localhost:8080/api/gridded/meta          # → JSON listing available runs/levels/parameters

# Watch the pipeline in real time
docker compose logs -f acquisition
docker compose logs -f decoder
```

The `frontend` container is currently flagged "unhealthy" by Docker even when working — its healthcheck uses `wget --spider` which is not in the `nginx:alpine` image. Cosmetic only; if `curl http://localhost:3000` returns 200, the SPA is up.

## Loading SIGWX features (manual, on-demand)

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

## GOES satellite imagery

GOES-19 imagery is pulled automatically from the public NOAA S3 bucket `noaa-goes19` (anonymous access — no AWS credentials needed). The decoder spawns a polling thread on startup that downloads the latest CONUS sector ABI L2 Cloud and Moisture Imagery for three channels (visible, upper water-vapor, clean IR), reprojects each to equirectangular lat/lon at 1800×1000, and writes JSON files to `/data/satellite/ch{NN}.json` on the `satellite_store` volume. The backend reads those files at request time and serves them via `GET /api/satellite/{channel}`.

Tunable via env vars:

- `SATELLITE_POLL_INTERVAL_SECS` (default `600`) — how often to refresh.
- `SATELLITE_DATA_DIR` (default `/data/satellite`) — where to write JSONs.

The first poll takes ~45 s (download + reproject all three channels) — `/api/satellite/{channel}` returns 404 until it completes.

## Iterating on code

| Change | Command |
|---|---|
| Edited Rust or Python source | `docker compose up --build <service>` (or `docker compose up --build` for all) |
| Added or modified a SQL migration in `db/migrations/` | `docker volume rm cirrus_pgdata && docker compose up --build` — migrations only run on a fresh DB |
| Edited frontend | `docker compose up --build frontend` for a containerized rebuild, or `cd services/frontend && npm run dev` for hot reload (proxied to the running backend on :8080) |

## Stopping and cleanup

```bash
docker compose down                                  # Stop services, keep volumes (data persists)
docker compose down -v                               # Stop services AND drop pgdata + grib_store (full reset)
docker volume rm cirrus_pgdata cirrus_grib_store     # Drop volumes explicitly without stopping
```

## Troubleshooting

- **`/api/sigwx` always returns 404** — expected until you run the SIGWX CLI loader (see above). It is not auto-ingested.
- **`/api/maxwind` is empty for the first cycle** — the GFS subset must include the max-wind level (`max_wind` / surface type 6). Check `acquisition` logs for download progress.
- **Decoder logs show "deadlock" warnings** — there is a known LISTEN/NOTIFY pattern that uses separate connections; if you see a hang, restart the decoder container. The fix landed in commit `80ddcc4`.
- **Migrations did not apply after a code pull** — Postgres only runs `docker-entrypoint-initdb.d` on a fresh data directory. Drop the `cirrus_pgdata` volume.
- **First build seems to hang** — `docker compose build` produces little output between layers. Check `docker stats` for activity. The Rust workspace alone takes 3–5 minutes on a clean cache.
- **Acquisition cannot reach upstreams** — verify the host has outbound HTTPS to `nomads.ncep.noaa.gov` and `aviationweather.gov`. Corporate proxies typically require `HTTPS_PROXY` env passthrough.

Per-service development commands (`cargo build`, `npm run dev`, `pytest`, etc.) are documented in `CLAUDE.md`.
