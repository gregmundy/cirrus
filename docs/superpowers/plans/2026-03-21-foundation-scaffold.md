# Foundation Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap the Cirrus repository so `docker compose up` starts Postgres + 7 services, all healthy and connected.

**Architecture:** Monorepo with a Cargo workspace (4 Rust services), a single Python project (2 services), and a Vite/React frontend. All orchestrated by Docker Compose on a bridge network, communicating through a shared Postgres instance.

**Tech Stack:** Rust (Axum, tokio, sqlx), Python 3.12 (psycopg), React 18 + TypeScript 5 + Vite + MapLibre GL JS + Zustand, PostgreSQL 16 + PostGIS + TimescaleDB, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-03-21-foundation-scaffold-design.md`

---

## File Map

### Root
| File | Responsibility |
|---|---|
| `.gitignore` | Ignore build artifacts, env files, IDE configs |
| `.env.example` | Template for local environment variables |
| `docker-compose.yml` | Orchestrate all 8 containers |
| `CLAUDE.md` | Updated with short service names and accurate commands |

### Database (`db/`)
| File | Responsibility |
|---|---|
| `db/Dockerfile` | Extend postgis image with TimescaleDB |
| `db/migrations/001_init.sql` | Enable PostGIS + TimescaleDB extensions |

### Rust Services (`services/rust/`)
| File | Responsibility |
|---|---|
| `services/rust/Cargo.toml` | Workspace manifest with shared dependencies |
| `services/rust/Dockerfile` | Shared multi-stage build (SERVICE build arg) |
| `services/rust/acquisition/Cargo.toml` | Crate manifest for acquisition service |
| `services/rust/acquisition/src/main.rs` | Health-check HTTP server + DB connection |
| `services/rust/backend/Cargo.toml` | Crate manifest for backend service |
| `services/rust/backend/src/main.rs` | Health-check HTTP server + DB connection |
| `services/rust/alerting/Cargo.toml` | Crate manifest for alerting service |
| `services/rust/alerting/src/main.rs` | Health-check HTTP server + DB connection |
| `services/rust/monitor/Cargo.toml` | Crate manifest for monitor service |
| `services/rust/monitor/src/main.rs` | Health-check HTTP server + DB connection |

### Python Services (`services/python/`)
| File | Responsibility |
|---|---|
| `services/python/pyproject.toml` | Project config, dependencies, entry points |
| `services/python/Dockerfile` | Python image with libeccodes-dev |
| `services/python/src/cirrus/__init__.py` | Package root |
| `services/python/src/cirrus/decoder/__init__.py` | Decoder package |
| `services/python/src/cirrus/decoder/main.py` | Decoder entry point: DB connect + health HTTP + NOTIFY loop |
| `services/python/src/cirrus/briefing/__init__.py` | Briefing package |
| `services/python/src/cirrus/briefing/main.py` | Briefing entry point: DB connect + health HTTP + NOTIFY loop |

### Frontend (`services/frontend/`)
| File | Responsibility |
|---|---|
| `services/frontend/package.json` | Dependencies and scripts |
| `services/frontend/tsconfig.json` | TypeScript configuration |
| `services/frontend/vite.config.ts` | Vite config with API proxy |
| `services/frontend/Dockerfile` | Build with node, serve with nginx |
| `services/frontend/index.html` | HTML entry point |
| `services/frontend/src/main.tsx` | React app mount |
| `services/frontend/src/App.tsx` | Full-viewport MapLibre map |

---

## Task 1: Git Init + Root Files

**Files:**
- Create: `.gitignore`
- Create: `.env.example`

- [ ] **Step 1: Initialize git repo**

```bash
cd /Users/greg/Development/cirrus
git init
git branch -M main
```

- [ ] **Step 2: Create .gitignore**

Create `.gitignore`:

```gitignore
# Rust
target/
/Cargo.lock

# Python
__pycache__/
*.pyc
*.egg-info/
.venv/
dist/

# Node
node_modules/
services/frontend/dist/

# Environment
.env

# Database
pgdata/

# OS
.DS_Store
Thumbs.db

# IDE
.idea/
.vscode/
*.swp
*.swo
```

- [ ] **Step 3: Create .env.example**

Create `.env.example`:

```env
POSTGRES_DB=cirrus
POSTGRES_USER=cirrus
POSTGRES_PASSWORD=cirrus_dev
DATABASE_URL=postgresql://cirrus:cirrus_dev@postgres:5432/cirrus
```

- [ ] **Step 4: Copy .env.example to .env**

```bash
cp .env.example .env
```

- [ ] **Step 5: Commit**

```bash
git add .gitignore .env.example CLAUDE.md docs/
git commit -m "init: git repo with gitignore, env template, and spec docs"
```

---

## Task 2: Database — Dockerfile + Migration

**Files:**
- Create: `db/Dockerfile`
- Create: `db/migrations/001_init.sql`

- [ ] **Step 1: Create db/Dockerfile**

Create `db/Dockerfile`:

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

- [ ] **Step 2: Create 001_init.sql**

Create `db/migrations/001_init.sql`:

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS timescaledb;
```

- [ ] **Step 3: Commit**

```bash
git add db/
git commit -m "feat(db): postgis + timescaledb dockerfile and init migration"
```

---

## Task 3: Rust Workspace + Shared Dockerfile

**Files:**
- Create: `services/rust/Cargo.toml`
- Create: `services/rust/Dockerfile`

- [ ] **Step 1: Create workspace Cargo.toml**

Create `services/rust/Cargo.toml`:

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

- [ ] **Step 2: Create shared Dockerfile**

Create `services/rust/Dockerfile`:

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

- [ ] **Step 3: Commit**

```bash
git add services/rust/Cargo.toml services/rust/Dockerfile
git commit -m "feat(rust): cargo workspace manifest and shared dockerfile"
```

---

## Task 4: Rust Service Crates

All four crates follow identical structure. Each one: Axum health endpoint + sqlx DB connection + tracing.

**Files:**
- Create: `services/rust/acquisition/Cargo.toml`
- Create: `services/rust/acquisition/src/main.rs`
- Create: `services/rust/backend/Cargo.toml`
- Create: `services/rust/backend/src/main.rs`
- Create: `services/rust/alerting/Cargo.toml`
- Create: `services/rust/alerting/src/main.rs`
- Create: `services/rust/monitor/Cargo.toml`
- Create: `services/rust/monitor/src/main.rs`

- [ ] **Step 1: Create acquisition crate**

Create `services/rust/acquisition/Cargo.toml`:

```toml
[package]
name = "acquisition"
version = "0.1.0"
edition = "2021"

[dependencies]
axum = { workspace = true }
tokio = { workspace = true }
sqlx = { workspace = true }
serde = { workspace = true }
serde_json = { workspace = true }
tracing = { workspace = true }
tracing-subscriber = { workspace = true }
```

Create `services/rust/acquisition/src/main.rs`:

```rust
use axum::{routing::get, Json, Router};
use serde_json::{json, Value};
use sqlx::postgres::PgPoolOptions;
use std::env;

const SERVICE_NAME: &str = "acquisition";
const PORT: u16 = 8081;

async fn health() -> Json<Value> {
    Json(json!({"status": "ok", "service": SERVICE_NAME}))
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .init();

    let database_url = env::var("DATABASE_URL").expect("DATABASE_URL must be set");

    let pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(&database_url)
        .await
        .expect("Failed to connect to database");

    let _conn = pool.acquire().await.expect("Failed to acquire connection");
    tracing::info!("{SERVICE_NAME} connected to database");

    let app = Router::new().route("/health", get(health));

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{PORT}"))
        .await
        .expect("Failed to bind");
    tracing::info!("{SERVICE_NAME} listening on port {PORT}");

    axum::serve(listener, app).await.expect("Server error");
}
```

- [ ] **Step 2: Create backend crate**

Create `services/rust/backend/Cargo.toml` — same as acquisition but `name = "backend"`.

Create `services/rust/backend/src/main.rs` — same structure as acquisition but:
```rust
const SERVICE_NAME: &str = "backend";
const PORT: u16 = 8080;
```

- [ ] **Step 3: Create alerting crate**

Create `services/rust/alerting/Cargo.toml` — same as acquisition but `name = "alerting"`.

Create `services/rust/alerting/src/main.rs` — same structure as acquisition but:
```rust
const SERVICE_NAME: &str = "alerting";
const PORT: u16 = 8082;
```

- [ ] **Step 4: Create monitor crate**

Create `services/rust/monitor/Cargo.toml` — same as acquisition but `name = "monitor"`.

Create `services/rust/monitor/src/main.rs` — same structure as acquisition but:
```rust
const SERVICE_NAME: &str = "monitor";
const PORT: u16 = 8083;
```

- [ ] **Step 5: Verify workspace compiles**

```bash
cd /Users/greg/Development/cirrus/services/rust
cargo check
```

Expected: compiles with no errors (warnings about unused pool are fine).

- [ ] **Step 6: Commit**

```bash
cd /Users/greg/Development/cirrus
git add services/rust/acquisition/ services/rust/backend/ services/rust/alerting/ services/rust/monitor/
git commit -m "feat(rust): four service crates with health endpoints and db connection"
```

---

## Task 5: Python Services

**Files:**
- Create: `services/python/pyproject.toml`
- Create: `services/python/Dockerfile`
- Create: `services/python/src/cirrus/__init__.py`
- Create: `services/python/src/cirrus/decoder/__init__.py`
- Create: `services/python/src/cirrus/decoder/main.py`
- Create: `services/python/src/cirrus/briefing/__init__.py`
- Create: `services/python/src/cirrus/briefing/main.py`

- [ ] **Step 1: Create pyproject.toml**

Create `services/python/pyproject.toml`:

```toml
[build-system]
requires = ["setuptools>=75.0"]
build-backend = "setuptools.build_meta"

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

[tool.setuptools.packages.find]
where = ["src"]
```

- [ ] **Step 2: Create Dockerfile**

Create `services/python/Dockerfile`:

```dockerfile
FROM python:3.12-slim

RUN apt-get update && apt-get install -y libeccodes-dev && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY pyproject.toml .
COPY src/ src/
RUN pip install --no-cache-dir ".[decode]"
```

- [ ] **Step 3: Create package structure**

Create `services/python/src/cirrus/__init__.py`:

```python
```

Create `services/python/src/cirrus/decoder/__init__.py`:

```python
```

Create `services/python/src/cirrus/briefing/__init__.py`:

```python
```

- [ ] **Step 4: Create decoder main.py**

Create `services/python/src/cirrus/decoder/main.py`:

```python
import asyncio
import logging
import os
from http.server import HTTPServer, BaseHTTPRequestHandler
from threading import Thread

import psycopg

SERVICE_NAME = "decoder"
PORT = 8090
logger = logging.getLogger(SERVICE_NAME)


class HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"status": "ok", "service": "decoder"}')
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass  # suppress default logging


def start_health_server():
    server = HTTPServer(("0.0.0.0", PORT), HealthHandler)
    server.serve_forever()


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

    database_url = os.environ["DATABASE_URL"]

    conn = psycopg.connect(database_url, autocommit=True)
    logger.info(f"{SERVICE_NAME} connected to database")

    # Start health check server in background thread
    health_thread = Thread(target=start_health_server, daemon=True)
    health_thread.start()
    logger.info(f"{SERVICE_NAME} health server on port {PORT}")

    # Listen for notifications (no handlers yet)
    conn.execute(f"LISTEN {SERVICE_NAME}_jobs")
    logger.info(f"{SERVICE_NAME} listening for notifications on {SERVICE_NAME}_jobs")

    while True:
        # Wait for notifications, timeout every 5s to keep the loop alive
        gen = conn.notifies(timeout=5.0)
        for notify in gen:
            logger.info(f"Received notification: {notify.channel} -> {notify.payload}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: Create briefing main.py**

Create `services/python/src/cirrus/briefing/main.py` — same structure as decoder but:

```python
SERVICE_NAME = "briefing"
PORT = 8091
```

And the health response body uses `"service": "briefing"`.

- [ ] **Step 6: Commit**

```bash
git add services/python/
git commit -m "feat(python): decoder and briefing services with health endpoints and db connection"
```

---

## Task 6: Frontend

**Files:**
- Create: `services/frontend/package.json`
- Create: `services/frontend/tsconfig.json`
- Create: `services/frontend/vite.config.ts`
- Create: `services/frontend/Dockerfile`
- Create: `services/frontend/index.html`
- Create: `services/frontend/src/main.tsx`
- Create: `services/frontend/src/App.tsx`

- [ ] **Step 1: Initialize frontend project**

```bash
cd /Users/greg/Development/cirrus/services/frontend
npm create vite@latest . -- --template react-ts
```

If prompted to overwrite, confirm. This scaffolds `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, and `src/`.

- [ ] **Step 2: Install dependencies**

```bash
cd /Users/greg/Development/cirrus/services/frontend
npm install maplibre-gl zustand
npm install -D @types/maplibre-gl
```

- [ ] **Step 3: Replace App.tsx with MapLibre map**

Replace `services/frontend/src/App.tsx`:

```tsx
import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

export default function App() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (map.current || !mapContainer.current) return;

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: "https://demotiles.maplibre.org/style.json",
      center: [0, 30],
      zoom: 2,
    });

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  return <div ref={mapContainer} style={{ width: "100vw", height: "100vh" }} />;
}
```

- [ ] **Step 4: Simplify main.tsx**

Replace `services/frontend/src/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

- [ ] **Step 5: Remove Vite boilerplate**

Delete default CSS and assets that Vite scaffolded:

```bash
cd /Users/greg/Development/cirrus/services/frontend
rm -f src/App.css src/index.css src/assets/react.svg public/vite.svg
```

- [ ] **Step 6: Update index.html**

Ensure `services/frontend/index.html` has no reference to removed files. Replace the `<title>` with `Cirrus`. Remove any favicon link to `vite.svg`.

- [ ] **Step 7: Configure vite.config.ts with API proxy**

Replace `services/frontend/vite.config.ts`:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
});
```

- [ ] **Step 8: Verify frontend builds**

```bash
cd /Users/greg/Development/cirrus/services/frontend
npm run build
```

Expected: builds successfully to `dist/`.

- [ ] **Step 9: Create Dockerfile**

Create `services/frontend/Dockerfile`:

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

- [ ] **Step 10: Commit**

```bash
cd /Users/greg/Development/cirrus
git add services/frontend/
git commit -m "feat(frontend): react + maplibre scaffold with full-viewport map"
```

---

## Task 7: Docker Compose

**Files:**
- Create: `docker-compose.yml`

- [ ] **Step 1: Create docker-compose.yml**

Create `docker-compose.yml`:

```yaml
services:
  postgres:
    build: db/
    environment:
      POSTGRES_DB: ${POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./db/migrations:/docker-entrypoint-initdb.d
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 5s
      timeout: 5s
      retries: 5
    restart: always

  acquisition:
    build:
      context: services/rust
      args:
        SERVICE: acquisition
    environment:
      DATABASE_URL: ${DATABASE_URL}
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:8081/health || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 3
    volumes:
      - grib_store:/data/grib
    restart: always

  backend:
    build:
      context: services/rust
      args:
        SERVICE: backend
    ports:
      - "8080:8080"
    environment:
      DATABASE_URL: ${DATABASE_URL}
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:8080/health || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 3
    restart: always

  alerting:
    build:
      context: services/rust
      args:
        SERVICE: alerting
    environment:
      DATABASE_URL: ${DATABASE_URL}
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:8082/health || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 3
    restart: always

  monitor:
    build:
      context: services/rust
      args:
        SERVICE: monitor
    environment:
      DATABASE_URL: ${DATABASE_URL}
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:8083/health || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 3
    restart: always

  decoder:
    build: services/python
    command: ["python", "-m", "cirrus.decoder.main"]
    environment:
      DATABASE_URL: ${DATABASE_URL}
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:8090/health || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 3
    volumes:
      - grib_store:/data/grib
    restart: always

  briefing:
    build: services/python
    command: ["python", "-m", "cirrus.briefing.main"]
    environment:
      DATABASE_URL: ${DATABASE_URL}
    depends_on:
      postgres:
        condition: service_started
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:8091/health || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 3
    restart: always

  frontend:
    build: services/frontend
    ports:
      - "3000:80"
    depends_on:
      backend:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "wget -q --spider http://localhost:80/ || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 3
    restart: always

volumes:
  pgdata:
  grib_store:
```

- [ ] **Step 2: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: docker compose with all 8 services, health checks, and volumes"
```

---

## Task 8: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update service names and structure in CLAUDE.md**

Update the service table in CLAUDE.md to use the canonical short names from the spec. Replace the existing service table with:

```markdown
| Service | Language | Role |
|---|---|---|
| **acquisition** | Rust (tokio, reqwest) | Polls SADIS/WIFS APIs, manages failover state machine, writes raw payloads |
| **decoder** | Python 3.12+ (ecCodes, lxml, Shapely, avwx-engine) | Decodes GRIB2/BUFR → arrays, IWXXM → features, TAC → records |
| **backend** | Rust (Axum) | REST + WebSocket API, serves frontend, coordinates services |
| **frontend** | React 18 + TypeScript 5, Zustand, MapLibre GL JS + Deck.gl | Operator UI with WebGL map rendering |
| **alerting** | Rust | Monitors for advisory products, pushes alerts via WebSocket |
| **briefing** | Python + Playwright | Generates PDF flight documentation |
| **monitor** | Rust | Health checks all services, raises operational alerts |
| **postgres** | PostgreSQL 16 + PostGIS 3.4 + TimescaleDB | Single database for all data types |
```

Also update the IPC pattern reference to match service names, and ensure Build & Run commands reference the correct paths:

```markdown
### Per-Service Development

**Rust services** (in `services/rust/`):
\```bash
cd services/rust
cargo build              # Build all workspace crates
cargo test               # Run all tests
cargo test -p backend    # Run tests for one crate
cargo clippy             # Lint
cargo fmt --check        # Check formatting
\```

**Python services** (in `services/python/`):
\```bash
cd services/python
pip install -e ".[decode]"          # Install in dev mode
python -m pytest                    # Run tests
python -m pytest tests/test_foo.py  # Single test file
ruff check .                        # Lint
ruff format --check .               # Check formatting
\```

**Frontend** (in `services/frontend/`):
\```bash
cd services/frontend
npm install              # Install dependencies
npm run dev              # Dev server with hot reload
npm test                 # Run tests
npm run lint             # ESLint
npm run build            # Production build
\```
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with canonical service names and accurate paths"
```

---

## Task 9: Docker Compose Smoke Test

- [ ] **Step 1: Build all images**

```bash
cd /Users/greg/Development/cirrus
docker compose build
```

Expected: all 8 images build successfully. The Rust build will take several minutes on first run.

- [ ] **Step 2: Start all services**

```bash
docker compose up -d
```

Expected: all containers start.

- [ ] **Step 3: Wait for healthy status**

```bash
docker compose ps
```

Expected: all 8 services show "healthy" status. Postgres should be healthy first, then the dependent services follow.

- [ ] **Step 4: Verify Rust health endpoints**

```bash
curl http://localhost:8080/health
```

Expected: `{"status":"ok","service":"backend"}`

- [ ] **Step 5: Verify frontend**

Open `http://localhost:3000` in a browser. Expected: a full-viewport MapLibre map with coastlines and country boundaries.

- [ ] **Step 6: Check logs for DB connections**

```bash
docker compose logs acquisition backend alerting monitor decoder briefing | grep "connected to database"
```

Expected: six lines, one per service, each confirming database connection.

- [ ] **Step 7: Tear down**

```bash
docker compose down
```

- [ ] **Step 8: Fix any issues found during smoke test**

If any service fails to start or health checks don't pass, debug and fix. Common issues:
- TimescaleDB extension not loading → check `shared_preload_libraries` in db/Dockerfile
- Rust services crash with linker error → ensure `libpq5` is in the runtime image
- Python services fail to connect → check `DATABASE_URL` env var is passed through

- [ ] **Step 9: Final commit if fixes were needed**

```bash
git add -A
git commit -m "fix: address issues found during smoke test"
```
