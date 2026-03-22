# Foundation Scaffold Design

**Date:** 2026-03-21
**Status:** Draft
**Scope:** Iteration 1 — foundational infrastructure for the Cirrus WAFS workstation

---

## 1. Goal

Establish the complete project skeleton so that `docker compose up` boots all services, each connected to Postgres and reporting healthy. No business logic, no data flow — just the foundation that iterations 2–12 build on.

### Success Criteria

- `docker compose up` starts all 8 containers (Postgres + 7 services)
- `docker compose ps` shows all containers healthy
- Each Rust service responds to `GET /health` with `200 OK`
- Python services connect to Postgres and stay alive
- Frontend serves a full-viewport MapLibre map in the browser at `localhost:3000`
- Git repo initialized with `.gitignore` and initial commit

---

## 2. Repository Structure

```
cirrus/
├── CLAUDE.md
├── docker-compose.yml
├── .gitignore
├── .env.example
├── docs/                          # existing spec docs (unchanged)
├── db/
│   ├── Dockerfile
│   └── migrations/
│       └── 001_init.sql
├── services/
│   ├── rust/                      # Cargo workspace root
│   │   ├── Cargo.toml             # workspace manifest with shared deps
│   │   ├── Dockerfile             # shared multi-stage Dockerfile (--build-arg SERVICE=<name>)
│   │   ├── acquisition/
│   │   │   ├── Cargo.toml
│   │   │   └── src/main.rs
│   │   ├── backend/
│   │   │   ├── Cargo.toml
│   │   │   └── src/main.rs
│   │   ├── alerting/
│   │   │   ├── Cargo.toml
│   │   │   └── src/main.rs
│   │   └── monitor/
│   │       ├── Cargo.toml
│   │       └── src/main.rs
│   ├── python/
│   │   ├── pyproject.toml
│   │   ├── Dockerfile
│   │   └── src/
│   │       └── cirrus/
│   │           ├── __init__.py
│   │           ├── decoder/
│   │           │   ├── __init__.py
│   │           │   └── main.py
│   │           └── briefing/
│   │               ├── __init__.py
│   │               └── main.py
│   └── frontend/
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       ├── Dockerfile
│       ├── index.html
│       └── src/
│           ├── main.tsx
│           └── App.tsx
```

---

## 3. Docker Compose

### 3.1 Services

| Service | Build Context | Ports | Depends On | Health Check |
|---|---|---|---|---|
| `postgres` | `db/` | 5432 (internal only) | — | `pg_isready` |
| `acquisition` | `services/rust/` (arg: `SERVICE=acquisition`) | — | postgres (healthy) | `GET /health` |
| `decoder` | `services/python/` | — | postgres (healthy) | `GET /health` (lightweight HTTP) |
| `backend` | `services/rust/` (arg: `SERVICE=backend`) | 8080:8080 | postgres (healthy) | `GET /health` |
| `alerting` | `services/rust/` (arg: `SERVICE=alerting`) | — | postgres (healthy) | `GET /health` |
| `briefing` | `services/python/` | — | postgres (started) | `GET /health` (lightweight HTTP) |
| `monitor` | `services/rust/` (arg: `SERVICE=monitor`) | — | postgres (healthy) | `GET /health` |
| `frontend` | `services/frontend/` | 3000:80 | backend | HTTP GET on nginx |

### 3.2 Shared Resources

- **`pgdata` volume:** Postgres data directory, persists across restarts
- **`grib_store` volume:** Shared between acquisition and decoder containers, empty at scaffold time but pre-wired for iteration 2
- **Network:** Default Compose bridge network; services reference each other by container name (e.g., `postgres:5432`, `backend:8080`)

### 3.3 Python Image Reuse

The `decoder` and `briefing` services use the same Docker image built from `services/python/Dockerfile`. They differ only in the `command` directive:

```yaml
decoder:
  build: services/python
  command: ["python", "-m", "cirrus.decoder.main"]

briefing:
  build: services/python
  command: ["python", "-m", "cirrus.briefing.main"]
```

### 3.4 Environment Variables

Defined in `.env.example` (copied to `.env` by the developer):

```
POSTGRES_DB=cirrus
POSTGRES_USER=cirrus
POSTGRES_PASSWORD=cirrus_dev
DATABASE_URL=postgresql://cirrus:cirrus_dev@postgres:5432/cirrus
```

All services read `DATABASE_URL` from environment. No secrets management at scaffold time — dev-only credentials.

---

## 4. Database

### 4.1 Migration Strategy

SQL files in `db/migrations/`, applied via Postgres's `/docker-entrypoint-initdb.d/` volume mount. Files run in lexicographic order on first container start (empty `pgdata` volume).

### 4.2 Initial Migration: `001_init.sql`

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS timescaledb;
```

No application tables. Schema creation begins in iteration 2.

### 4.3 TimescaleDB in the Postgres Image

The base `postgis/postgis:16-3.4` image does not include TimescaleDB. A `db/Dockerfile` extends it to install TimescaleDB:

```dockerfile
FROM postgis/postgis:16-3.4
RUN apt-get update && apt-get install -y curl gnupg lsb-release && \
    curl -fsSL https://packagecloud.io/timescale/timescaledb/gpgkey | \
      gpg --dearmor -o /usr/share/keyrings/timescaledb.gpg && \
    echo "deb [signed-by=/usr/share/keyrings/timescaledb.gpg] https://packagecloud.io/timescale/timescaledb/debian/ $(lsb_release -cs) main" \
      > /etc/apt/sources.list.d/timescaledb.list && \
    apt-get update && \
    apt-get install -y timescaledb-2-postgresql-16 && \
    rm -rf /var/lib/apt/lists/*
RUN echo "shared_preload_libraries = 'timescaledb'" >> /usr/share/postgresql/postgresql.conf.sample
```

The Compose `postgres` service uses `build: db/` instead of a raw image reference. Migrations are mounted via `volumes: - ./db/migrations:/docker-entrypoint-initdb.d`.

---

## 5. Rust Services

### 5.1 Cargo Workspace

The workspace root at `services/rust/Cargo.toml`:

```toml
[workspace]
members = ["acquisition", "backend", "alerting", "monitor"]
resolver = "2"

[workspace.dependencies]
axum = "0.8"
tokio = { version = "1", features = ["full"] }
sqlx = { version = "0.8", features = ["runtime-tokio", "postgres"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
```

Each service crate inherits from workspace dependencies.

### 5.2 Service Behavior (All Four)

Each Rust service at scaffold time:

1. Initialize `tracing_subscriber` with env filter (default `info`)
2. Read `DATABASE_URL` from environment
3. Create a `sqlx::PgPool` and verify connectivity (`pool.acquire().await`)
4. Log `"{service} connected to database"`
5. Start an Axum HTTP server on a service-specific port
6. Serve `GET /health` returning:
   ```json
   {"status": "ok", "service": "acquisition"}
   ```
7. Stay alive, serving health checks

### 5.3 Service Ports

| Service | Internal Port |
|---|---|
| acquisition | 8081 |
| backend | 8080 |
| alerting | 8082 |
| monitor | 8083 |

Only `backend` is exposed to the host (8080:8080). Other ports are internal to the Docker network.

### 5.4 Dockerfile

A single shared Dockerfile at `services/rust/Dockerfile` builds any workspace member via a `SERVICE` build arg. The build context is `services/rust/` (the workspace root), so all crates are available to Cargo:

```dockerfile
ARG SERVICE
# Stage 1: Build
FROM rust:1.84 AS builder
ARG SERVICE
WORKDIR /app
COPY Cargo.toml ./
COPY Cargo.lock* ./
COPY acquisition/ acquisition/
COPY backend/ backend/
COPY alerting/ alerting/
COPY monitor/ monitor/
RUN cargo build --release --bin ${SERVICE}

# Stage 2: Runtime
FROM debian:bookworm-slim
ARG SERVICE
RUN apt-get update && apt-get install -y ca-certificates libpq5 && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/${SERVICE} /usr/local/bin/service
CMD ["service"]
```

In `docker-compose.yml`, each Rust service specifies the build arg:

```yaml
acquisition:
  build:
    context: services/rust
    args:
      SERVICE: acquisition
```

---

## 6. Python Services

### 6.1 Project Configuration

Single `pyproject.toml` at `services/python/`:

```toml
[project]
name = "cirrus"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "psycopg[binary]>=3.2",
]

[project.optional-dependencies]
decode = [
    "eccodes>=2.0",
    "lxml>=5.0",
    "shapely>=2.0",
]

[project.scripts]
cirrus-decoder = "cirrus.decoder.main:main"
cirrus-briefing = "cirrus.briefing.main:main"
```

### 6.2 Service Behavior (Both)

Each Python service at scaffold time:

1. Read `DATABASE_URL` from environment
2. Connect to Postgres using `psycopg`
3. Log `"{service} connected to database"`
4. Start a lightweight HTTP server (e.g., `http.server` or a minimal `asyncio` handler) on a service-specific port serving `/health` with `200 OK` — this enables Docker health checks
5. Enter a loop listening for NOTIFY on a service-specific channel (no handlers yet)
6. Stay alive

The decoder listens on port 8090 and the briefing service on port 8091 (internal only). The decoder uses `condition: service_healthy` for Postgres dependency; the briefing service uses `condition: service_started` since it is on-demand and non-critical at scaffold time.

### 6.3 Dockerfile

```dockerfile
FROM python:3.12-slim
RUN apt-get update && apt-get install -y libeccodes-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY pyproject.toml .
COPY src/ src/
RUN pip install --no-cache-dir ".[decode]"
# CMD set by docker-compose.yml per service
```

The `libeccodes-dev` system package is installed for the ecCodes Python bindings. At scaffold time the decode dependencies are installed but unused — this ensures the image is ready for iteration 2 without a rebuild of the base layer.

---

## 7. Frontend

### 7.1 Stack

- React 18 + TypeScript 5
- Vite for build tooling
- MapLibre GL JS 4.x for the map
- Zustand for state management (store initialized, empty)

### 7.2 What Renders

A single full-viewport page with:

- A MapLibre GL JS map filling the browser window
- Default view: world extent (center `[0, 30]`, zoom 2)
- Basemap: MapLibre's `demotiles` style (`https://demotiles.maplibre.org/style.json`) — a free, no-API-key-required tile source with coastlines, country boundaries, and labels. Suitable for scaffold; will be replaced with a self-hosted tile source (e.g., Protomaps PMTiles served by nginx) before evaluation to meet the offline requirement
- No data layers, no UI controls, no panels

### 7.3 Dockerfile

```dockerfile
# Stage 1: Build
FROM node:22-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Serve
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
```

### 7.4 Development Mode

For local development outside Docker, `npm run dev` starts Vite's dev server with hot reload. A `vite.config.ts` proxy rule forwards `/api/*` to `localhost:8080` (the backend) so the frontend can be developed against a running backend without CORS issues.

---

## 8. Git Repository

### 8.1 Initialization

- `git init` in the project root
- `.gitignore` covering: Rust `target/`, Python `__pycache__`/`.venv`/`*.egg-info`, Node `node_modules`/`dist`, environment files (`.env`), Postgres data, OS files (`.DS_Store`), IDE configs
- `.env.example` committed (template), `.env` gitignored

### 8.2 Initial Commit

Single commit with the full scaffold, on `main` branch.

---

## 9. CLAUDE.md Updates

When the scaffold is committed, CLAUDE.md must be updated to use the canonical short service names used throughout this spec: `acquisition`, `backend`, `decoder`, `alerting`, `briefing`, `monitor`, `frontend`, `postgres`. The current CLAUDE.md uses long-form names (`data-acquisition`, `decoding-engine`, `backend-api`) which will cause incorrect commands in LLM-assisted development.

---

## 10. What Is Explicitly Out of Scope

- Application database tables (iteration 2)
- Business logic in any service
- IPC via LISTEN/NOTIFY (wired but no handlers)
- Data acquisition, decoding, or rendering
- CI/CD pipeline
- Tests (added per-service as business logic arrives)
- HTTPS/TLS (dev environment only)
- Authentication
- The `grib_store` volume is defined but unused
