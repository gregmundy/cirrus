# WAFS Workstation — Technical Architecture Document

**Document ID:** WAFS-WS-TAD-2026-001  
**Companion to:** WAFS-WS-SPEC-2026-001, WAFS-WS-IRG-2026-001, WAFS-WS-ECM-2026-001  
**Version:** 1.0 — March 2026  
**Purpose:** Define the software architecture, technology stack, component design, data flows, and deployment model for a next-generation WAFS workstation implementation.

---

## Table of Contents

1. [Architecture Philosophy](#1-architecture-philosophy)
2. [System Context](#2-system-context)
3. [Deployment Model](#3-deployment-model)
4. [Technology Stack](#4-technology-stack)
5. [Component Architecture](#5-component-architecture)
6. [Data Acquisition Service](#6-data-acquisition-service)
7. [Decoding Engine](#7-decoding-engine)
8. [Data Store](#8-data-store)
9. [Backend API Server](#9-backend-api-server)
10. [Frontend Application](#10-frontend-application)
11. [SIGWX Rendering Engine](#11-sigwx-rendering-engine)
12. [OPMET Subsystem](#12-opmet-subsystem)
13. [Alerting Service](#13-alerting-service)
14. [Briefing & Print Engine](#14-briefing-engine)
15. [System Monitor](#15-system-monitor)
16. [Inter-Component Communication](#16-communication)
17. [Data Flow Diagrams](#17-data-flows)
18. [Security Architecture](#18-security)
19. [Scaling & Multi-Seat Operation](#19-scaling)
20. [Build, Test & Deployment Pipeline](#20-build-pipeline)
21. [Project Estimation](#21-estimation)

---

## 1. Architecture Philosophy

### 1.1 Guiding Principles

**Don't reinvent scientific libraries.** The GRIB2/BUFR decoding problem was solved decades ago by ECMWF (ecCodes), NCEP (wgrib2, g2clib), and the broader meteorological community. Our value is in integration, visualization, operational workflow, and compliance — not binary format parsing.

**Hybrid deployment.** Many WAFS end users are state meteorological authorities with variable internet quality. The system must run entirely on-premises on a single workstation — no mandatory cloud dependency. But it should also be deployable as a hosted service for organisations that prefer that model.

**Web UI, local engine.** Use browser-based rendering for the operator interface (modern WebGL mapping, React component model, easy updates) but run the data engine locally as a native service. This gives us the best of both worlds: rich interactive visualization without cloud latency concerns.

**Operational reliability over feature richness.** This is a 24/7/365 safety-adjacent aviation system. Every design decision should favour reliability, predictability, and graceful degradation. If both APIs go down, the workstation continues displaying the last-ingested data with clear staleness warnings. If a decode fails, it's logged and retried — never silently dropped.

**Compliance-driven rendering.** The SIGWX rendering engine is the hardest and most compliance-critical component. It gets the most engineering investment and the most rigorous testing. Every other component exists to feed it correct data and present it to the operator.

### 1.2 Architecture Style

The system follows a **local service-oriented architecture** — a set of independent services communicating over local IPC, all containerised and orchestrated on a single host. This is not microservices in the distributed-systems sense; it's structured modular design with process isolation for reliability.

```
┌─────────────────────────────────────────────────────────────┐
│                    Operator Workstation                      │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐ │
│  │  Data     │  │ Decoding │  │ Backend  │  │  Frontend  │ │
│  │  Acquisi- │→ │ Engine   │→ │ API      │→ │  (Browser) │ │
│  │  tion     │  │          │  │ Server   │  │            │ │
│  └──────────┘  └──────────┘  └──────────┘  └────────────┘ │
│       │              │             │               ↑        │
│       │              ↓             │               │        │
│       │        ┌──────────┐        │        ┌────────────┐ │
│       │        │PostgreSQL│←───────┘        │  Alerting  │ │
│       └───────→│+ PostGIS │                 │  Service   │ │
│                └──────────┘                 └────────────┘ │
│                                                             │
│  ┌──────────┐  ┌──────────┐                                │
│  │ Briefing │  │  System  │                                │
│  │ Engine   │  │  Monitor │                                │
│  └──────────┘  └──────────┘                                │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. System Context

### 2.1 External Systems

| System | Relationship | Protocol |
|---|---|---|
| SADIS API (WAFC London) | Primary or backup data source | HTTPS, OGC API-EDR, OAuth2 |
| WIFS API (WAFC Washington) | Primary or backup data source | HTTPS, OGC API-EDR, API Key |
| Operator browsers | UI clients (1–5 concurrent seats) | HTTP/WebSocket (localhost) |
| Network printer | Flight documentation output | IPP/CUPS |
| Enterprise directory (optional) | User authentication | LDAP/AD |
| NTP server | Time synchronization | NTP |

### 2.2 System Boundaries

The workstation is a **self-contained system**. It has no runtime dependency on any external service other than the SADIS/WIFS APIs for data. The database, application server, and frontend are all local. In a network outage, the system continues operating with cached data.

---

## 3. Deployment Model

### 3.1 Primary: On-Premises Containerised

All components packaged as OCI containers, orchestrated with Docker Compose or Podman Compose on a single host.

```yaml
# docker-compose.yml (simplified)
services:
  postgres:
    image: postgis/postgis:16-3.4
    volumes:
      - pgdata:/var/lib/postgresql/data
    environment:
      POSTGRES_DB: wafs
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password

  data-acquisition:
    image: wafs/acquisition:latest
    depends_on: [postgres]
    restart: always
    environment:
      SADIS_CLIENT_ID_FILE: /run/secrets/sadis_id
      SADIS_CLIENT_SECRET_FILE: /run/secrets/sadis_secret
      WIFS_API_KEY_FILE: /run/secrets/wifs_key
      PRIMARY_SOURCE: sadis  # or 'wifs'

  decoding-engine:
    image: wafs/decoder:latest
    depends_on: [postgres, data-acquisition]
    restart: always

  backend-api:
    image: wafs/backend:latest
    depends_on: [postgres]
    ports:
      - "8080:8080"
    restart: always

  alerting:
    image: wafs/alerting:latest
    depends_on: [postgres, backend-api]
    restart: always

  briefing:
    image: wafs/briefing:latest
    depends_on: [backend-api]

  frontend:
    image: wafs/frontend:latest
    ports:
      - "443:443"
    depends_on: [backend-api]

  monitor:
    image: wafs/monitor:latest
    depends_on: [postgres, data-acquisition]

volumes:
  pgdata:
  grib_store:
```

### 3.2 Alternative: Tauri Desktop Application

For deployments where containerisation isn't feasible, a **Tauri** desktop application wraps the entire system into a single installable binary. Tauri uses Rust for the backend (which aligns with our data engine) and a system webview for the UI. The PostgreSQL database would be replaced with SQLite + SpatiaLite for zero-configuration operation.

### 3.3 Alternative: Cloud-Hosted SaaS

For organisations preferring managed access, the same container set deploys to a cloud provider (AWS ECS, GCP Cloud Run, Azure Container Instances) with a managed PostgreSQL instance. Multi-tenant isolation via schema separation or dedicated instances per customer. This model suits airline operations centres with many dispatchers.

---

## 4. Technology Stack

### 4.1 Stack Summary

| Layer | Technology | Justification |
|---|---|---|
| **Data acquisition** | Rust (tokio, reqwest) | Async I/O, memory safety, 24/7 reliability |
| **GRIB2/BUFR decoding** | ecCodes (C lib) via Rust FFI or Python bindings | Industry standard, WAFS-validated, actively maintained by ECMWF |
| **IWXXM/XML parsing** | Python 3.12+ (lxml, Shapely) | Schema validation, GML geometry extraction |
| **TAC METAR/TAF parsing** | Python (avwx-engine) | Mature, well-tested, actively maintained |
| **Database** | PostgreSQL 16 + PostGIS 3.4 + TimescaleDB | Spatial queries, time-series, relational — one engine for all data types |
| **Backend API** | Rust (Axum framework) | Low-latency WebSocket support, serves frontend, coordinates services |
| **Frontend framework** | React 18 + TypeScript 5 | Complex multi-panel state management, large ecosystem |
| **State management** | Zustand | Lightweight, performant, suits the multi-panel workstation model |
| **Map rendering** | MapLibre GL JS 4.x | Open-source WebGL maps, custom layers, smooth interaction |
| **Data layers** | Deck.gl 9.x | GPU-accelerated geospatial rendering — wind barbs, contours, polygons |
| **Projections** | Proj4js + custom polar renderer | Mercator, Polar Stereographic, Lambert Conformal Conic |
| **Charts/graphs** | D3.js | Vertical cross-sections, time-series plots, probability displays |
| **Alerting push** | WebSocket (native, via Axum) | Real-time alert delivery to all connected operator sessions |
| **Print/PDF export** | Playwright (headless Chromium) | Pixel-identical PDF output from the map view |
| **Containerisation** | Docker / Podman | Reproducible builds, easy updates, multi-environment deployment |
| **OS** | Ubuntu 24.04 LTS or RHEL 9 | Long-term support, wide hardware compatibility |

### 4.2 Why Rust for the Core Services

The data acquisition service and backend API are the system's backbone — they run 24/7, handle API credentials, manage failover state, and coordinate all other components. The choice of Rust for these is deliberate:

- **Memory safety without garbage collection** — no GC pauses during time-critical data ingestion
- **Async runtime (tokio)** — efficient handling of concurrent API connections, WebSocket clients, and database queries
- **Predictable performance** — sub-millisecond response times for API queries, critical for interactive map rendering
- **Error handling model** — Rust's Result type forces explicit handling of every failure path, which matters in a 24/7 system where silent failures are unacceptable
- **Single binary deployment** — each service compiles to one static binary, simplifying container images

### 4.3 Why Python for Scientific Processing

Python is the lingua franca of the meteorological computing ecosystem. The key libraries — ecCodes, cfgrib, xarray, Shapely, lxml — all have their primary or best-maintained bindings in Python. Fighting this ecosystem by trying to do everything in Rust would slow development and introduce risk.

The boundary between Rust and Python is clean:

- Rust handles I/O, state, scheduling, serving
- Python handles decoding, parsing, scientific computation
- Communication via a job queue (PostgreSQL LISTEN/NOTIFY or a simple Redis queue)

### 4.4 Why MapLibre + Deck.gl for Visualization

The evaluation criteria demand smooth pan/zoom, multiple projections, layer toggling, and animation at ≥5fps with thousands of features. This rules out server-side rendered map tiles and demands client-side WebGL rendering.

**MapLibre GL JS** provides the base map (coastlines, boundaries, labels) with sub-frame pan/zoom. It's the open-source fork of Mapbox GL, has no usage-based pricing, and supports custom vector tile sources.

**Deck.gl** adds the meteorological data layers on top. It's designed specifically for rendering large geospatial datasets on GPU. Each WAFS data type gets a custom Deck.gl layer:

| Data Type | Deck.gl Layer Type | Notes |
|---|---|---|
| Wind barbs | Custom IconLayer subclass | Symbol rotation, hemisphere-aware barb orientation |
| Temperature/height contours | ContourLayer or custom PathLayer | Marching squares output rendered as paths |
| Turbulence/icing fills | HeatmapLayer or custom BitmapLayer | Colour-mapped raster from decoded GRIB2 |
| SIGWX turbulence areas | PolygonLayer + TextLayer | Dashed outline, reference number labels |
| SIGWX CB areas | Custom ScallopedPolygonLayer | **Must implement scalloped-line algorithm** |
| SIGWX icing areas | PolygonLayer | Distinct line style from CB |
| Jet streams | PathLayer + IconLayer | Line with wind barbs and speed/FL annotations |
| Tropopause contours | PathLayer | Dotted line with FL labels |
| SIGMET polygons | PolygonLayer | Colour-coded by phenomenon |
| METAR stations | ScatterplotLayer | Colour-coded by flight category |
| Special AIREPs | ScatterplotLayer + IconLayer | Point symbol with phenomenon indicator |
| Volcanic/TC symbols | IconLayer | Standard ICAO symbols |

---

## 5. Component Architecture

### 5.1 Component Inventory

| Component | Language | Container | Persistent State | Restart Policy |
|---|---|---|---|---|
| Data Acquisition Service | Rust | `wafs/acquisition` | Failover state in DB | Always restart |
| Decoding Engine | Python | `wafs/decoder` | None (stateless worker) | Always restart |
| PostgreSQL + PostGIS | N/A | `postgis/postgis` | pgdata volume | Always restart |
| Backend API Server | Rust | `wafs/backend` | Session state in-memory | Always restart |
| Frontend | TypeScript/React | `wafs/frontend` (nginx) | None | Always restart |
| Alerting Service | Rust | `wafs/alerting` | Alert history in DB | Always restart |
| Briefing Engine | Python + Playwright | `wafs/briefing` | Generated PDFs on disk | On-demand |
| System Monitor | Rust | `wafs/monitor` | Metrics in DB | Always restart |

### 5.2 Process Supervision

Every container uses `restart: always`. Within each container, the main process is PID 1 with proper signal handling (SIGTERM for graceful shutdown). The system monitor watches all other services and raises alerts if any become unresponsive.

---

## 6. Data Acquisition Service

### 6.1 Responsibilities

- Authenticate with SADIS API (OAuth2) and WIFS API (API key)
- Poll for new data at correct intervals (5min OPMET, detect 6-hourly gridded/SIGWX)
- Download GRIB2, IWXXM, and OPMET payloads
- Manage failover state machine between primary and backup WAFC
- Write raw payloads to the file system and notify the decoding engine
- Verify data integrity (checksums, digital signatures where available)

### 6.2 State Machine

```
                    ┌──────────────┐
                    │              │
         ┌────────→│   PRIMARY    │←────────┐
         │         │   ACTIVE     │         │
         │         └──────┬───────┘         │
         │                │                 │
         │         3 consecutive            │
         │         failures                 │
         │                │                 │
         │                ↓                 │
         │         ┌──────────────┐         │
         │         │              │         │
         │         │  FAILOVER    │   Primary recovers
         │         │  IN PROGRESS │   (health check OK)
         │         │              │         │
         │         └──────┬───────┘         │
         │                │                 │
         │                ↓                 │
         │         ┌──────────────┐         │
         │         │              │         │
         └─────────│   BACKUP     │─────────┘
                   │   ACTIVE     │
                   │              │
                   └──────────────┘
```

States are persisted to the database so failover survives service restarts. The operator is notified on every state transition.

### 6.3 Polling Implementation

```rust
// Pseudocode — acquisition loop
loop {
    let now = Utc::now();

    // OPMET: every 5 minutes
    if now - last_opmet_poll >= Duration::minutes(5) {
        fetch_opmet(active_source).await?;
        last_opmet_poll = now;
    }

    // Gridded & SIGWX: check for new model run
    if new_model_run_available(active_source).await? {
        fetch_gridded(active_source).await?;
        fetch_sigwx(active_source).await?;
        notify_decoder("new_model_run");
    }

    // Health check backup source periodically
    if now - last_backup_check >= Duration::minutes(15) {
        if state == BackupActive && primary_healthy().await? {
            transition_to(PrimaryActive);
            alert("Reverted to primary source");
        }
        last_backup_check = now;
    }

    sleep(Duration::seconds(30)).await;
}
```

---

## 7. Decoding Engine

### 7.1 Responsibilities

- Decode GRIB2 payloads to NumPy arrays (wind, temp, humidity, hazards)
- Decode BUFR SIGWX to GeoJSON-like feature collections (transitional, until 2027)
- Parse IWXXM XML to internal weather feature objects
- Parse TAC OPMET to structured observation/forecast records
- Write decoded data to PostgreSQL and notify the backend API

### 7.2 Architecture

```python
# Decoding engine — worker process
# Listens for notifications from the acquisition service

class DecodingEngine:
    def __init__(self):
        self.grib_decoder = GribDecoder()      # wraps ecCodes
        self.iwxxm_parser = IWXXMParser()       # wraps lxml + Shapely
        self.tac_parser = TACParser()           # wraps avwx-engine
        self.bufr_decoder = BUFRDecoder()       # wraps ecCodes (transitional)

    def on_new_grib(self, filepath):
        fields = self.grib_decoder.decode(filepath)
        for field in fields:
            store_gridded_field(field)           # → PostgreSQL + binary array storage
        notify("gridded_data_updated")

    def on_new_sigwx(self, filepath):
        features = self.iwxxm_parser.parse_sigwx(filepath)
        store_sigwx_features(features)          # → PostgreSQL (PostGIS geometries)
        notify("sigwx_updated")

    def on_new_opmet(self, payload):
        records = self.tac_parser.parse_bulk(payload.tac_data)
        records += self.iwxxm_parser.parse_opmet(payload.iwxxm_data)
        store_opmet_records(records)            # → PostgreSQL (TimescaleDB)
        check_advisory_alerts(records)          # → alerting service
        notify("opmet_updated")
```

### 7.3 GRIB2 Decoding Detail

```python
import eccodes

class GribDecoder:
    def decode(self, filepath: str) -> list[GriddedField]:
        fields = []
        with open(filepath, 'rb') as f:
            while True:
                msgid = eccodes.codes_grib_new_from_file(f)
                if msgid is None:
                    break
                field = GriddedField(
                    parameter=eccodes.codes_get(msgid, 'shortName'),
                    level=eccodes.codes_get(msgid, 'level'),
                    level_type=eccodes.codes_get(msgid, 'typeOfFirstFixedSurface'),
                    forecast_hour=eccodes.codes_get(msgid, 'forecastTime'),
                    run_time=self._extract_run_time(msgid),
                    ni=eccodes.codes_get(msgid, 'Ni'),
                    nj=eccodes.codes_get(msgid, 'Nj'),
                    values=eccodes.codes_get_array(msgid, 'values'),
                    lat_first=eccodes.codes_get(msgid, 'latitudeOfFirstGridPointInDegrees'),
                    lon_first=eccodes.codes_get(msgid, 'longitudeOfFirstGridPointInDegrees'),
                    lat_last=eccodes.codes_get(msgid, 'latitudeOfLastGridPointInDegrees'),
                    lon_last=eccodes.codes_get(msgid, 'longitudeOfLastGridPointInDegrees'),
                    d_lat=eccodes.codes_get(msgid, 'jDirectionIncrementInDegrees'),
                    d_lon=eccodes.codes_get(msgid, 'iDirectionIncrementInDegrees'),
                    centre=eccodes.codes_get(msgid, 'centre'),
                )
                fields.append(field)
                eccodes.codes_release(msgid)
        return fields
```

### 7.4 IWXXM Parsing Detail

```python
from lxml import etree
from shapely.geometry import Polygon, LineString, Point
from shapely import wkt

NSMAP = {
    'iwxxm': 'http://icao.int/iwxxm/2025-1',
    'gml': 'http://www.opengis.net/gml/3.2',
    'aixm': 'http://www.aixm.aero/schema/5.1.1',
}

class IWXXMParser:
    def parse_sigwx(self, filepath: str) -> list[WeatherFeature]:
        tree = etree.parse(filepath)
        features = []
        # Extract jet streams
        for jet in tree.findall('.//iwxxm:JetStream', NSMAP):
            features.append(self._parse_jet(jet))
        # Extract turbulence, icing, CB, tropopause, volcanoes, TCs...
        for turb in tree.findall('.//iwxxm:Turbulence', NSMAP):
            features.append(self._parse_area_feature(turb, 'turbulence'))
        # ... similar for all feature types
        return features

    def _parse_gml_polygon(self, element) -> Polygon:
        """Extract GML polygon — note lat,lon coordinate order."""
        pos_list = element.find('.//gml:posList', NSMAP)
        coords_flat = [float(x) for x in pos_list.text.split()]
        # GML is lat,lon — convert to lon,lat for Shapely
        coords = [(coords_flat[i+1], coords_flat[i])
                   for i in range(0, len(coords_flat), 2)]
        return Polygon(coords)
```

---

## 8. Data Store

### 8.1 PostgreSQL Schema Overview

```sql
-- Reference data
CREATE TABLE aerodromes (
    icao_code    CHAR(4) PRIMARY KEY,
    name         TEXT NOT NULL,
    latitude     DOUBLE PRECISION NOT NULL,
    longitude    DOUBLE PRECISION NOT NULL,
    country      TEXT NOT NULL,
    fir          TEXT,
    icao_region  TEXT NOT NULL,
    geom         GEOMETRY(Point, 4326)
);
CREATE INDEX idx_aerodromes_geom ON aerodromes USING GIST(geom);

CREATE TABLE fir_boundaries (
    fir_id       TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    country      TEXT NOT NULL,
    geom         GEOMETRY(MultiPolygon, 4326) NOT NULL
);
CREATE INDEX idx_fir_geom ON fir_boundaries USING GIST(geom);

-- Gridded data metadata (actual arrays stored as binary files)
CREATE TABLE gridded_fields (
    id           BIGSERIAL PRIMARY KEY,
    source       TEXT NOT NULL,        -- 'egrr' or 'kwbc'
    parameter    TEXT NOT NULL,        -- 'u', 'v', 't', 'gh', 'r', etc.
    level_hpa    INTEGER,
    flight_level INTEGER,
    run_time     TIMESTAMPTZ NOT NULL,
    forecast_hour INTEGER NOT NULL,
    resolution   TEXT NOT NULL,        -- '0p25' or '1p25'
    file_path    TEXT NOT NULL,        -- path to binary array file
    ingested_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_gridded_lookup ON gridded_fields(parameter, flight_level, run_time, forecast_hour);

-- SIGWX features (PostGIS geometries)
CREATE TABLE sigwx_features (
    id           BIGSERIAL PRIMARY KEY,
    source       TEXT NOT NULL,
    feature_type TEXT NOT NULL,        -- 'jet', 'turbulence', 'icing', 'cb', etc.
    run_time     TIMESTAMPTZ NOT NULL,
    valid_time   TIMESTAMPTZ NOT NULL,
    properties   JSONB NOT NULL,       -- severity, FL range, speed, etc.
    geom         GEOMETRY(Geometry, 4326) NOT NULL,
    ingested_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_sigwx_time ON sigwx_features(valid_time);
CREATE INDEX idx_sigwx_geom ON sigwx_features USING GIST(geom);

-- OPMET observations (TimescaleDB hypertable)
CREATE TABLE opmet_reports (
    time         TIMESTAMPTZ NOT NULL,
    station      CHAR(4) NOT NULL,
    report_type  TEXT NOT NULL,        -- 'METAR', 'SPECI', 'TAF', 'SIGMET', etc.
    source_format TEXT NOT NULL,       -- 'TAC' or 'IWXXM'
    raw_text     TEXT,
    decoded      JSONB NOT NULL,
    geom         GEOMETRY(Geometry, 4326),
    ingested_at  TIMESTAMPTZ DEFAULT NOW()
);
SELECT create_hypertable('opmet_reports', 'time');
CREATE INDEX idx_opmet_station ON opmet_reports(station, time DESC);
CREATE INDEX idx_opmet_type ON opmet_reports(report_type, time DESC);

-- Advisory products
CREATE TABLE advisories (
    id           BIGSERIAL PRIMARY KEY,
    advisory_type TEXT NOT NULL,       -- 'VAA', 'TCA', 'SWX', 'ASHTAM', 'NUCLEAR'
    source_format TEXT NOT NULL,
    issuing_centre TEXT,
    raw_text     TEXT,
    decoded      JSONB,
    graphic_path TEXT,                 -- path to PNG if applicable
    received_at  TIMESTAMPTZ DEFAULT NOW(),
    acknowledged BOOLEAN DEFAULT FALSE,
    acknowledged_by TEXT,
    acknowledged_at TIMESTAMPTZ
);

-- Alert history
CREATE TABLE alert_log (
    id           BIGSERIAL PRIMARY KEY,
    alert_type   TEXT NOT NULL,
    priority     TEXT NOT NULL,        -- 'CRITICAL', 'HIGH', 'MEDIUM'
    advisory_id  BIGINT REFERENCES advisories(id),
    summary      TEXT NOT NULL,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    acknowledged BOOLEAN DEFAULT FALSE,
    acknowledged_by TEXT,
    acknowledged_at TIMESTAMPTZ
);

-- System health
CREATE TABLE acquisition_log (
    id           BIGSERIAL PRIMARY KEY,
    source       TEXT NOT NULL,
    collection   TEXT NOT NULL,
    run_time     TIMESTAMPTZ,
    items_expected INTEGER,
    items_received INTEGER,
    complete     BOOLEAN,
    duration_ms  INTEGER,
    logged_at    TIMESTAMPTZ DEFAULT NOW()
);
```

### 8.2 Gridded Data Storage

Decoded GRIB2 arrays are too large for PostgreSQL BLOBs. Store them as memory-mapped binary files on a dedicated SSD volume:

```
/data/grib/
  egrr/
    2026031200/          # run_time
      u_FL300_T12.bin    # U-wind at FL300, T+12
      v_FL300_T12.bin    # V-wind at FL300, T+12
      ...
  kwbc/
    2026031200/
      ...
```

Each `.bin` file is a flat array of 32-bit floats (Ni × Nj values in row-major order). The PostgreSQL `gridded_fields` table indexes these files. The backend API memory-maps the file on demand for serving to the frontend.

---

## 9. Backend API Server

### 9.1 Responsibilities

- Serve decoded data to the frontend via REST and WebSocket
- Handle user authentication (local or LDAP)
- Coordinate WebSocket connections for real-time alerts and data update notifications
- Serve static frontend assets (or reverse-proxied via nginx)

### 9.2 API Endpoints

```
REST endpoints:

GET  /api/gridded/fields?param={p}&fl={fl}&run={run}&fh={fh}
     → Returns binary array (application/octet-stream) or JSON metadata

GET  /api/sigwx/features?valid_time={t}&source={s}
     → Returns GeoJSON FeatureCollection of SIGWX features for a timestep

GET  /api/sigwx/timesteps?run={run}
     → Returns list of available SIGWX timesteps for animation

GET  /api/opmet/reports?type={t}&station={s}&fir={f}&region={r}&since={ts}
     → Returns OPMET reports with filtering, sorting, pagination

GET  /api/opmet/map?type={t}&bbox={bbox}
     → Returns GeoJSON for map plotting (METAR points, SIGMET polygons)

GET  /api/advisories?type={t}&since={ts}
     → Returns advisory messages and graphics

GET  /api/advisories/{id}/graphic
     → Returns PNG advisory graphic

GET  /api/reference/aerodromes?search={q}
     → Aerodrome lookup

GET  /api/reference/firs?search={q}
     → FIR lookup

GET  /api/system/status
     → System health, data currency, acquisition state

POST /api/briefing/generate
     → Generates flight documentation package, returns PDF URL

WebSocket endpoints:

WS   /ws/events
     → Pushes: data_updated, sigwx_updated, opmet_updated, new_alert
```

### 9.3 Data Serialization

- Gridded arrays: served as raw binary (Float32Array) for maximum frontend performance — the browser receives bytes and maps directly to a GPU texture or typed array
- Vector features (SIGWX, OPMET): served as GeoJSON — universally supported by MapLibre and Deck.gl
- Metadata and lists: JSON

---

## 10. Frontend Application

### 10.1 Application Shell

```
┌─────────────────────────────────────────────────────────┐
│ Toolbar: [Source ▾] [Projection ▾] [ICAO Area ▾]       │
│          [Time Slider ◄ ■ ►] [T+12 12:00Z]  [🔔 3]    │
├───────────────────────────────────────┬─────────────────┤
│                                       │                 │
│           Map Display                 │   Side Panel    │
│                                       │                 │
│   ┌─────────────────────────┐        │  [OPMET List]   │
│   │  MapLibre + Deck.gl     │        │  [Alerts]       │
│   │                         │        │  [Advisories]   │
│   │  Layers:                │        │  [Feature Info] │
│   │  □ Wind barbs           │        │                 │
│   │  □ Temperature          │        │                 │
│   │  □ Jet streams          │        │                 │
│   │  □ Turbulence           │        │                 │
│   │  □ Icing                │        │                 │
│   │  □ CB                   │        │                 │
│   │  □ Tropopause           │        │                 │
│   │  □ SIGMETs              │        │                 │
│   │  □ METARs               │        │                 │
│   │                         │        │                 │
│   └─────────────────────────┘        │                 │
│                                       │                 │
├───────────────────────────────────────┴─────────────────┤
│ Status: ● SADIS Active | Last update: 12:04Z | ⚠ 0     │
└─────────────────────────────────────────────────────────┘
```

### 10.2 Key React Components

```
<App>
  <Toolbar>
    <SourceSelector />        // EGRR / KWBC toggle
    <ProjectionSelector />    // Mercator / Polar N / Polar S / Lambert
    <ICAOAreaSelector />      // Areas A through M + Custom
    <TimeSlider />            // T+6 to T+48 with play/pause
    <AlertBadge />            // Unacknowledged alert count
  </Toolbar>
  <MainLayout>
    <MapPanel>
      <MapLibreMap>
        <DeckGLOverlay>
          <WindBarbLayer />
          <ContourLayer />
          <SigwxFeatureLayer />
          <JetStreamLayer />
          <OpmetStationLayer />
          <SigmetPolygonLayer />
          <SpecialAirepLayer />
        </DeckGLOverlay>
      </MapLibreMap>
      <LayerControl />        // Checkboxes for each layer
      <Legend />              // Dynamic legend per active layers
    </MapPanel>
    <SidePanel>
      <OpmetListView />       // TAC/IWXXM reports with sort/filter
      <AlertPanel />          // Active and historical alerts
      <AdvisoryPanel />       // VAA/TCA/SWx with graphics
      <FeatureInfoPanel />    // Click-on-feature details
    </SidePanel>
  </MainLayout>
  <StatusBar />               // Source, last update, health
</App>
```

### 10.3 State Management

```typescript
// Zustand store — simplified
interface WAFSStore {
  // Data source
  activeSource: 'egrr' | 'kwbc';
  failoverActive: boolean;

  // Map state
  projection: 'mercator' | 'polar-north' | 'polar-south' | 'lambert';
  icaoArea: string | null;           // 'A' through 'M' or null for custom
  viewport: { lat: number; lon: number; zoom: number };

  // Time control
  currentTimestep: number;           // T+6 to T+48
  animating: boolean;
  animationSpeed: number;

  // Layer visibility
  layers: Record<string, boolean>;   // 'wind', 'temp', 'jets', etc.

  // Active data
  sigwxFeatures: GeoJSON.FeatureCollection;
  opmetReports: OpmetReport[];
  activeAlerts: Alert[];

  // Data currency
  lastGriddedUpdate: Date | null;
  lastSigwxUpdate: Date | null;
  lastOpmetUpdate: Date | null;
  dataStaleness: 'current' | 'stale' | 'critical';
}
```

### 10.4 WebSocket Event Handling

```typescript
// Connect to backend WebSocket for real-time updates
const ws = new WebSocket(`wss://${host}/ws/events`);

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  switch (msg.type) {
    case 'opmet_updated':
      refreshOpmetData();       // re-fetch OPMET from REST API
      break;
    case 'sigwx_updated':
      refreshSigwxFeatures();   // re-fetch SIGWX GeoJSON
      break;
    case 'gridded_data_updated':
      refreshGriddedLayers();   // re-fetch active gridded layers
      break;
    case 'new_alert':
      addAlert(msg.alert);      // push to alert panel
      showAlertNotification(msg.alert);  // banner + sound
      break;
    case 'source_failover':
      updateSourceStatus(msg);  // update status bar
      break;
  }
};
```

---

## 11. SIGWX Rendering Engine

### 11.1 Why This Is the Hardest Component

The SIGWX renderer must produce output that is **meteorologically identical** to the WAFC cross-check PNG charts. This is the single requirement most likely to cause evaluation failure. The challenges are:

- **Scalloped lines** for CB areas have no standard algorithm — you must implement a curve-fitting approach that produces evenly-spaced concave arcs along polygon boundaries
- **Label placement** must avoid overlaps while maintaining clear association between labels and features — this is a known NP-hard problem in cartography
- **Jet stream rendering** requires speed annotations at variable intervals along a curved path with correct wind barb orientation
- **Multi-projection rendering** means all of the above must work correctly in Mercator, Polar Stereographic, and Lambert Conformal Conic
- **Antimeridian handling** requires splitting polygons and lines that cross 180° longitude

### 11.2 Scalloped Line Algorithm

```
Input: Polygon boundary as ordered coordinate array
Output: SVG/Canvas path with scalloped (concave arc) appearance

Algorithm:
1. Walk along the polygon boundary at constant arc-length intervals (e.g., 15px at current zoom)
2. At each interval point, compute the outward normal to the boundary
3. Create a quadratic Bézier curve segment where:
   - Start point = current boundary point
   - End point = next boundary point
   - Control point = midpoint offset INWARD by a fixed distance along the normal
4. This produces concave arcs that create the "scalloped" visual effect
5. Scale the interval and offset with zoom level to maintain consistent appearance
```

### 11.3 Label Placement Strategy

```
For each SIGWX feature requiring a label:
1. Compute the feature's centroid (or a suitable anchor point for lines)
2. Generate 8 candidate positions around the anchor (N, NE, E, SE, S, SW, W, NW)
3. For each candidate, compute a bounding box for the label text
4. Score each candidate:
   - Penalty for overlap with other labels
   - Penalty for overlap with other features
   - Penalty for distance from anchor
   - Bonus for proximity to feature edge (for polygon labels)
5. Select the highest-scoring position
6. If no position is overlap-free, use the least-overlapping and apply a leader line

For jet stream speed/FL labels:
- Place at regular intervals along the jet axis
- Offset perpendicular to the axis direction
- Rotate text to follow the axis direction
```

### 11.4 Antimeridian Polygon Splitting

```
Input: Polygon that crosses 180° longitude
Output: MultiPolygon with parts on each side of the antimeridian

Algorithm:
1. Detect crossing: consecutive vertices where one lon > 170° and next lon < -170° (or vice versa)
2. For each crossing edge, compute the intersection point with the 180° meridian
3. Split the polygon into two parts along the meridian
4. Close each part by adding vertices along the meridian line
5. Return as MultiPolygon — MapLibre/Deck.gl renders both parts correctly
```

---

## 12. OPMET Subsystem

### 12.1 Dual-Format Pipeline

```
TAC text → TACParser → OpmetRecord → PostgreSQL → REST API → Frontend
IWXXM XML → IWXXMParser → OpmetRecord → PostgreSQL → REST API → Frontend
```

Both parsers produce the same `OpmetRecord` structure. The frontend doesn't know or care which format the data came from — it renders from the unified record.

### 12.2 Human-Readable IWXXM Rendering

The frontend includes a template engine that transforms `OpmetRecord` decoded fields into structured human-readable text:

```typescript
function renderMetarHumanReadable(record: OpmetRecord): string {
  const d = record.decoded;
  return [
    `METAR ${record.station} ${formatTime(record.time)}`,
    `Wind: ${d.wind_dir}° at ${d.wind_speed} kt${d.wind_gust ? `, gusting ${d.wind_gust} kt` : ''}`,
    `Visibility: ${formatVisibility(d.visibility)}`,
    `Weather: ${d.weather || 'None'}`,
    `Cloud: ${formatClouds(d.clouds)}`,
    `Temperature: ${d.temperature}°C / Dewpoint: ${d.dewpoint}°C`,
    `QNH: ${d.qnh} hPa`,
    d.trend ? `Trend: ${d.trend}` : null,
  ].filter(Boolean).join('\n');
}
```

### 12.3 Sorting and Filtering

The OPMET list view supports all evaluation-required sort/filter operations:

| Operation | Implementation |
|---|---|
| Sort by data type | SQL: `ORDER BY report_type` |
| Sort by station | SQL: `ORDER BY station` |
| Sort by country | SQL: `JOIN aerodromes ON ... ORDER BY country` |
| Sort by FIR | SQL: `JOIN aerodromes ON ... ORDER BY fir` |
| Filter by region | SQL: `JOIN aerodromes ON ... WHERE icao_region = ?` |
| Filter by airport | SQL: `WHERE station = ?` |
| Filter by FIR | SQL: `JOIN aerodromes ON ... WHERE fir = ?` |

---

## 13. Alerting Service

### 13.1 Detection Pipeline

```
New OPMET/advisory data ingested
       │
       ▼
Compare message IDs against known set
       │
       ▼ (new message detected)
Check message type against alert trigger table
       │
       ▼ (match found)
Create alert record in database
       │
       ▼
Push alert via WebSocket to all connected clients
       │
       ▼
Frontend displays notification banner + sound
```

### 13.2 Alert Priority Handling

| Priority | Visual | Audio | Dismissal |
|---|---|---|---|
| CRITICAL | Full-screen modal, red background | Continuous tone until acknowledged | Requires explicit acknowledgement |
| HIGH | Persistent top banner, amber | Single alert tone | Persist until acknowledged, auto-dismiss after 60s with warning |
| MEDIUM | Badge count on alert panel | None (configurable) | Auto-dismiss after viewing |

---

## 14. Briefing & Print Engine

### 14.1 Flight Documentation Generation

```
Input: Route (waypoints), flight level, departure time
Output: PDF briefing package

Steps:
1. Query relevant SIGWX features intersecting the route corridor
2. Query gridded wind/temp data for leg wind calculations
3. Query OPMET for departure, destination, alternate, and en-route aerodromes
4. Query active SIGMETs along the route
5. Render SIGWX chart centered on the route in headless Chromium
6. Compose multi-page PDF:
   - Cover page (route, date, aircraft, operator)
   - SIGWX chart (route overlay)
   - Wind/temp table by flight level and leg
   - OPMET compilation (METARs, TAFs for relevant aerodromes)
   - Active SIGMETs along route
   - Active advisories (VAA, TCA if relevant)
7. Return PDF URL for download/print
```

### 14.2 Print Quality

Headless Chromium renders at 300 DPI. The map view is captured as a high-resolution PNG, then composited into the PDF. This ensures the printed SIGWX chart is pixel-identical to the screen display, meeting Criterion 3b.

---

## 15. System Monitor

### 15.1 Health Dashboard

The monitor provides a web-accessible dashboard showing:

- Data acquisition status (last poll time, success/failure, items received)
- Data currency (age of newest gridded, SIGWX, and OPMET data)
- Failover state (primary/backup, transition history)
- Storage utilization (database size, GRIB file storage)
- Service health (all containers running, response latency)
- Alert history and acknowledgement status

### 15.2 Internal Health Checks

Every service exposes a `/health` endpoint. The monitor polls these every 30 seconds and raises alerts if any service becomes unresponsive for more than 2 consecutive checks.

---

## 16. Inter-Component Communication

| From | To | Mechanism | Purpose |
|---|---|---|---|
| Acquisition → Decoder | PostgreSQL NOTIFY | "New GRIB2/SIGWX/OPMET available" |
| Decoder → Backend | PostgreSQL NOTIFY | "Decoded data ready for serving" |
| Backend → Frontend | WebSocket | Real-time data update and alert push |
| Alerting → Backend | PostgreSQL NOTIFY | "New alert created" |
| Backend → Alerting | REST (internal) | Advisory classification requests |
| Monitor → All | HTTP health checks | Service liveness verification |
| Frontend → Backend | REST + WebSocket | Data queries and event subscription |

PostgreSQL LISTEN/NOTIFY is used for internal IPC because it's already present in the stack (no additional infrastructure), is reliable, transactional, and handles the volume easily (dozens of events per hour, not thousands per second).

---

## 17. Data Flow Diagrams

### 17.1 Gridded Data Flow

```
SADIS/WIFS API
     │
     │ HTTPS GET (GRIB2 payload)
     ▼
Data Acquisition Service
     │
     │ Write to /data/grib/{source}/{run}/
     │ INSERT INTO acquisition_log
     │ NOTIFY 'new_grib'
     ▼
Decoding Engine
     │
     │ ecCodes decode → NumPy array → .bin file
     │ INSERT INTO gridded_fields (metadata)
     │ NOTIFY 'gridded_updated'
     ▼
Backend API Server
     │
     │ Memory-map .bin file
     │ Serve as binary array via REST
     │ Push 'gridded_data_updated' via WebSocket
     ▼
Frontend (Browser)
     │
     │ Receive Float32Array
     │ Upload as WebGL texture
     │ Render via Deck.gl layer
     ▼
Operator's Screen
```

### 17.2 SIGWX Data Flow

```
SADIS/WIFS API
     │
     │ HTTPS GET (IWXXM XML payload)
     ▼
Data Acquisition Service
     │
     │ Write XML to staging
     │ NOTIFY 'new_sigwx'
     ▼
Decoding Engine (IWXXM Parser)
     │
     │ lxml parse → Shapely geometries
     │ INSERT INTO sigwx_features (PostGIS)
     │ NOTIFY 'sigwx_updated'
     ▼
Backend API Server
     │
     │ Query PostGIS → GeoJSON
     │ Push 'sigwx_updated' via WebSocket
     ▼
Frontend (SIGWX Rendering Engine)
     │
     │ Render features via custom Deck.gl layers
     │ Apply ICAO symbology (scalloped lines, dashed, etc.)
     │ Legend generation
     ▼
Operator's Screen
```

### 17.3 Alert Flow

```
OPMET/Advisory data ingested
     │
     ▼
Decoding Engine
     │
     │ Classifies message type
     │ Detects genuinely new advisory
     │ INSERT INTO advisories
     │ NOTIFY 'new_advisory'
     ▼
Alerting Service
     │
     │ Determines priority (CRITICAL/HIGH/MEDIUM)
     │ INSERT INTO alert_log
     │ NOTIFY 'new_alert'
     ▼
Backend API Server
     │
     │ Push alert via WebSocket to ALL connected sessions
     ▼
Frontend (ALL operator browsers)
     │
     │ Display notification banner
     │ Play audible alert
     │ Add to alert panel
     ▼
Operator acknowledges → UPDATE alert_log SET acknowledged = true
```

---

## 18. Security Architecture

### 18.1 Credential Management

- API credentials (SADIS OAuth2 client ID/secret, WIFS API key) stored as Docker secrets or encrypted environment files — never in source code or plain-text config
- Database credentials similarly managed as secrets
- Token refresh (SADIS OAuth2) handled automatically by the acquisition service — token renewed 5 minutes before expiry

### 18.2 Network Security

- All external connections (SADIS/WIFS APIs) use TLS 1.2+
- Frontend served over HTTPS (self-signed cert for local deployment, proper cert for cloud)
- Internal container-to-container communication over Docker bridge network — not exposed externally
- Only ports 443 (frontend HTTPS) and 8080 (backend API) exposed on the host

### 18.3 User Authentication

- Local mode: username/password stored with bcrypt hashing in PostgreSQL
- Enterprise mode: LDAP/Active Directory integration via the backend API
- Role-based access: Administrator (full config), Operator (full data access), Viewer (read-only)
- Session tokens with configurable timeout (default: 8 hours)

### 18.4 Data Integrity

- SADIS digital signature verification on received data (where signatures are provided)
- SHA-256 checksums computed and stored for all downloaded payloads
- Tamper-evident audit logging: all data modifications, alert acknowledgements, and configuration changes logged with timestamp and user

---

## 19. Scaling & Multi-Seat Operation

### 19.1 Concurrent Operator Support

The specification requires ≥5 simultaneous operator sessions. The architecture handles this naturally:

- Backend API server handles concurrent REST and WebSocket connections (Axum is async and can handle thousands of connections)
- Each browser session maintains its own viewport, layer state, and time selection
- All sessions share the same data — there's one database, one acquisition service, one source of truth
- WebSocket broadcasts ensure all sessions receive alerts simultaneously
- No session-to-session interference — one operator's pan/zoom doesn't affect another

### 19.2 Performance Budget

| Operation | Budget | Bottleneck | Mitigation |
|---|---|---|---|
| Gridded field serve (one FL) | <200ms | Disk I/O (memory-mapped file) | SSD storage, OS page cache |
| SIGWX GeoJSON serve | <100ms | PostGIS query | Spatial index, result caching |
| OPMET list query | <500ms | TimescaleDB scan | Time-based partitioning, indexes |
| Map pan/zoom | <16ms (60fps) | GPU rendering | Deck.gl GPU-accelerated layers |
| SIGWX animation frame | <200ms (5fps) | Feature swap + re-render | Pre-fetch all timesteps, cache in frontend |
| Alert delivery | <1s end-to-end | WebSocket push | Always-on connection, no polling |

### 19.3 Data Volume Estimates

| Data Type | Per Model Run | Daily (4 runs) | 36-Hour Retention |
|---|---|---|---|
| GRIB2 0.25° (all params) | ~2 GB | ~8 GB | ~12 GB |
| GRIB2 1.25° (all params) | ~50 MB | ~200 MB | ~300 MB |
| SIGWX IWXXM (15 timesteps) | ~20 MB | ~80 MB | ~120 MB |
| OPMET (global, 5-min cycle) | ~1 MB/cycle | ~288 MB | ~10.4 GB (28-day ICAO retention) |
| Advisory graphics (PNG) | Variable | ~10 MB | ~50 MB |
| **Total active storage** | | | **~25 GB** |

This fits comfortably on a 2 TB SSD with room for historical retention.

---

## 20. Build, Test & Deployment Pipeline

### 20.1 Repository Structure

```
wafs-workstation/
├── services/
│   ├── acquisition/          # Rust — data acquisition service
│   │   ├── src/
│   │   ├── Cargo.toml
│   │   └── Dockerfile
│   ├── backend/              # Rust — API server
│   │   ├── src/
│   │   ├── Cargo.toml
│   │   └── Dockerfile
│   ├── decoder/              # Python — decoding engine
│   │   ├── src/
│   │   ├── pyproject.toml
│   │   └── Dockerfile
│   ├── alerting/             # Rust — alerting service
│   │   ├── src/
│   │   ├── Cargo.toml
│   │   └── Dockerfile
│   ├── briefing/             # Python + Playwright — PDF generation
│   │   ├── src/
│   │   └── Dockerfile
│   └── monitor/              # Rust — system monitor
│       ├── src/
│       └── Dockerfile
├── frontend/                 # React + TypeScript
│   ├── src/
│   │   ├── components/
│   │   │   ├── map/
│   │   │   │   ├── MapPanel.tsx
│   │   │   │   ├── layers/
│   │   │   │   │   ├── WindBarbLayer.ts
│   │   │   │   │   ├── SigwxFeatureLayer.ts
│   │   │   │   │   ├── ScallopedPolygonLayer.ts
│   │   │   │   │   ├── JetStreamLayer.ts
│   │   │   │   │   ├── ContourLayer.ts
│   │   │   │   │   ├── OpmetStationLayer.ts
│   │   │   │   │   └── SigmetPolygonLayer.ts
│   │   │   │   └── Legend.tsx
│   │   │   ├── opmet/
│   │   │   ├── alerts/
│   │   │   ├── toolbar/
│   │   │   └── briefing/
│   │   ├── stores/
│   │   ├── utils/
│   │   └── App.tsx
│   ├── package.json
│   └── Dockerfile
├── database/
│   ├── migrations/           # SQL migration files
│   └── seed/                 # Reference data (aerodromes, FIRs, ICAO areas)
├── tests/
│   ├── integration/          # End-to-end tests
│   ├── rendering/            # SIGWX cross-check comparison tests
│   └── fixtures/             # Sample GRIB2, IWXXM, TAC files
├── docker-compose.yml
├── docker-compose.prod.yml
└── README.md
```

### 20.2 Testing Strategy

| Test Type | Scope | Tooling | Frequency |
|---|---|---|---|
| Unit tests (Rust) | Acquisition logic, failover state machine, API routing | `cargo test` | Every commit |
| Unit tests (Python) | GRIB2 decode accuracy, IWXXM parsing, TAC parsing | `pytest` | Every commit |
| Unit tests (Frontend) | Component rendering, state management | Vitest + React Testing Library | Every commit |
| Integration tests | Full data pipeline: ingest → decode → serve → render | Docker Compose test environment | Every PR |
| SIGWX rendering tests | Compare rendered output against WAFC PNG cross-checks | Playwright screenshot comparison | Weekly against live data |
| Performance tests | Decode latency, API response time, animation framerate | Custom benchmarks | Per release |
| Security tests | Dependency audit, credential handling, TLS config | `cargo audit`, `pip audit`, Trivy | Weekly |

### 20.3 CI/CD Pipeline

```
Push to main branch
     │
     ├── Rust: cargo test + cargo clippy + cargo audit
     ├── Python: pytest + ruff lint + pip audit
     ├── Frontend: vitest + eslint + TypeScript check
     │
     ▼ (all pass)
Build container images
     │
     ▼
Integration test suite (Docker Compose with test fixtures)
     │
     ▼ (all pass)
Push images to container registry
     │
     ▼
Deploy to staging environment
     │
     ▼
Manual SIGWX rendering verification (weekly)
     │
     ▼
Production release (tagged)
```

---

## 21. Project Estimation

### 21.1 Component Complexity and Size Estimates

| Component | Estimated LOC | Complexity | Notes |
|---|---|---|---|
| Data Acquisition Service | 3,000–4,000 | Medium | API clients, failover state machine, polling logic |
| Decoding Engine | 4,000–6,000 | Medium | ecCodes wrapper, IWXXM parser, TAC parser, BUFR (transitional) |
| Database Schema + Migrations | 1,000–1,500 | Low | SQL schema, indexes, seed data |
| Backend API Server | 5,000–7,000 | Medium | REST endpoints, WebSocket, auth, file serving |
| Frontend — Shell & State | 4,000–5,000 | Medium | React app shell, Zustand stores, WebSocket handler |
| Frontend — Map & Layers | 10,000–15,000 | **Very High** | Custom Deck.gl layers, projection handling, IDL splitting |
| SIGWX Rendering Engine | 8,000–12,000 | **Very High** | Scalloped lines, label placement, symbology, animation |
| OPMET Subsystem | 4,000–6,000 | Medium | List view, human-readable renderer, map plotting |
| Alerting Service | 2,000–3,000 | Low–Medium | Detection, priority, WebSocket push |
| Briefing Engine | 3,000–4,000 | Medium | Route analysis, PDF composition, Playwright rendering |
| System Monitor | 2,000–3,000 | Low | Health checks, dashboard |
| Reference Data & Tooling | 2,000–3,000 | Low | Aerodrome DB, FIR boundaries, ICAO area presets |
| Test Suites | 8,000–12,000 | Medium | Unit, integration, rendering comparison |
| **Total** | **56,000–85,000** | | |

### 21.2 Team and Timeline Estimate

| Phase | Duration | Team | Deliverable |
|---|---|---|---|
| **Phase 1: Foundation** | 8 weeks | 3 engineers | Data acquisition, decoding engine, database, basic backend API. System can ingest and store all WAFS data. |
| **Phase 2: Core Visualization** | 12 weeks | 4 engineers | Frontend shell, MapLibre integration, Deck.gl layers for gridded data (wind, temp, hazards). Criteria 2a–2c passable. |
| **Phase 3: SIGWX Engine** | 12 weeks | 3 engineers | IWXXM SIGWX rendering with full ICAO compliance, multi-timestep animation, label placement. Criterion 3 passable. |
| **Phase 4: OPMET & Advisories** | 8 weeks | 3 engineers | OPMET list/map display, human-readable IWXXM, advisory graphics, alerting subsystem. Criteria 4–9 passable. |
| **Phase 5: Briefing & Polish** | 6 weeks | 3 engineers | Flight documentation generator, print output, system monitor, performance optimization. |
| **Phase 6: Evaluation Prep** | 4 weeks | 2 engineers | Cross-check validation against WAFC PNGs, edge case testing (IDL, poles), documentation for evaluator. |
| **Total** | **~50 weeks** | **Peak 4 engineers** | Production-ready, evaluation-ready workstation |

### 21.3 Risk-Adjusted Timeline

The SIGWX rendering engine (Phase 3) is the schedule risk. Label placement algorithms and cross-check matching may require multiple iteration cycles with visual QA against WAFC reference charts. Budget 4 additional weeks of contingency for Phase 3.

**Realistic total: 12–14 months** from project start to evaluation readiness, with a peak team of 4 engineers and a sustained team of 3.

---

**END OF TECHNICAL ARCHITECTURE DOCUMENT**

*This document should be read alongside the Technical Specification (WAFS-WS-SPEC-2026-001), Implementation Reference Guide (WAFS-WS-IRG-2026-001), and Evaluation Compliance Matrix (WAFS-WS-ECM-2026-001).*
