# WAFS Workstation — Implementation Reference Guide

**Document ID:** WAFS-WS-IRG-2026-001  
**Companion to:** WAFS-WS-SPEC-2026-001 (Technical Specification)  
**Version:** 1.1 — March 2026  
**Purpose:** Provide sufficient implementation detail for an engineering team (or LLM-assisted development) to build a compliant next-generation WAFS workstation from the technical specification.  
**Change from v1.0:** Incorporated all requirements from SADIS API Workstation Software Evaluation Criteria (WG-MOG/25, June 2024). Added Sections 15–18 covering advisory products, alerting subsystem, IWXXM human-readable rendering, and ICAO fixed chart area definitions.

---

## Table of Contents

1. [How to Use This Document](#1-how-to-use-this-document)
2. [API Integration — SADIS & WIFS](#2-api-integration)
3. [GRIB2 Decoding](#3-grib2-decoding)
4. [BUFR SIGWX Decoding](#4-bufr-sigwx-decoding)
5. [IWXXM Parsing](#5-iwxxm-parsing)
6. [TAC OPMET Parsing](#6-tac-opmet-parsing)
7. [SIGWX Chart Rendering](#7-sigwx-chart-rendering)
8. [Gridded Data Visualization](#8-gridded-data-visualization)
9. [Map Projections & Coordinate Systems](#9-map-projections)
10. [Data Storage & Lifecycle](#10-data-storage)
11. [Failover & Redundancy Logic](#11-failover)
12. [External Reference Documents](#12-external-references)
13. [Open-Source Libraries & Tools](#13-libraries)
14. [Test Vectors & Validation](#14-test-vectors)
15. [Advisory Product Display (VAA, TCA, SWx, Nuclear)](#15-advisory-products)
16. [Operator Alerting Subsystem](#16-alerting)
17. [IWXXM Human-Readable Rendering](#17-iwxxm-human-readable)
18. [ICAO Fixed SIGWX Chart Areas](#18-icao-chart-areas)
19. [OPMET Geographic Display & Auto-Refresh](#19-opmet-map-display)
20. [Reference Data — FIR Boundaries & Station Database](#20-reference-data)

---

## 1. How to Use This Document

This guide is organized by implementation subsystem. Each section provides:

- **What you're building** — functional description
- **Authoritative source documents** — exact document title, version, section numbers, and URLs where available
- **Data structures & formats** — octet-level binary layouts, XML schema paths, API request/response patterns
- **Implementation guidance** — algorithms, edge cases, recommended libraries
- **Acceptance criteria** — how to verify correctness

**Critical principle:** Do NOT reimplement GRIB2/BUFR decoding from scratch. Use established open-source libraries (ecCodes, wgrib2, g2clib) and build workstation logic on top of them. The value of the workstation is in integration, visualization, and operational workflow — not in reinventing binary decoders.

---

## 2. API Integration — SADIS & WIFS {#2-api-integration}

### 2.1 Architecture Overview

Both SADIS API (WAFC London, Met Office) and WIFS API (WAFC Washington, NOAA/AWC) implement the **OGC API — Environmental Data Retrieval (EDR)** standard. They have been deliberately harmonized to enable mutual failover.

**Key reference documents:**
- OGC API-EDR Standard: https://ogcapi.ogc.org/edr/
- WIFS User's Guide v9.0, June 2025: https://aviationweather.gov/wifs/users_guide/
- SADIS API User Guide v1.05, February 2024 (available from Met Office upon SADIS registration)
- WIFS API OpenAPI specification: https://aviationweather.gov/wifs/api/openapi?f=html
- WIFS API Interactive Query Builder: https://aviationweather.gov/wifs/api/query_builder?f=html

### 2.2 WIFS API Details

**Base URL:** `https://aviationweather.gov/wifs/api`

**Authentication:** API key passed as HTTP header.
```
X-API-Key: {your_api_key}
```
API keys are managed via the WIFS account page. Keys are valid for one year; up to 5 keys may be active simultaneously.

**Rate limits:** Maximum 5,000 individual API requests per day per account.

### 2.3 SADIS API Details

**Base URL:** Provided upon SADIS registration via Met Office APIM Developer Portal.

**Authentication:** OAuth2 Client Credentials flow.
```
1. POST to token endpoint with Client ID + Client Secret
2. Receive Bearer Token (valid for 1 hour)
3. Include in all subsequent requests: Authorization: Bearer {token}
4. Regenerate token before expiry
```

**Rate limits:** 200 requests per day per unique user (for SIGWX API). Gridded data has different limits — consult SADIS terms.

### 2.4 OGC EDR Query Patterns

The API organizes data into **collections**. The fundamental interaction pattern is:

#### Step 1: Enumerate Collections
```
GET {base_url}/collections
Accept: application/json
```
Returns JSON describing all available collections with metadata (parameters, spatial extent, temporal extent, available tiles).

#### Step 2: List Items in a Collection
```
GET {base_url}/collections/{collectionId}/items
Accept: application/json
```
Returns metadata on specific data files available for download. Items are identified by an `id` field using the WMO AHL code form: `T1T2T3A1A2B1B2B3_B1B2B3FLnnn`.

#### Step 3: Retrieve Data
```
GET {base_url}/collections/{collectionId}/items/{itemId}?f={format}
```
Or using location-based queries:
```
GET {base_url}/collections/{collectionId}/locations/{locationId}?parameter-name={param}&datetime={datetime}/{offset}&f={format}
```

**Response formats:** GRIB2 for gridded data, IWXXM (XML) for SIGWX, JSON for metadata.

#### Example: Retrieve WAFC London 0.25° wind/temp data
```bash
curl "https://aviationweather.gov/wifs/api/collections/egrr_wafs_windtempgeo_0p25/items/{item_id}?f=grib2" \
  -H "X-API-Key: YOUR_KEY" \
  --output wind_temp.grib2
```

### 2.5 Available Collections (WIFS API)

| Collection ID | Description | Source | Resolution |
|---|---|---|---|
| `egrr_wafs_windtempgeo_0p25` | Wind, temp, geopotential height | WAFC London | 0.25° |
| `kwbc_wafs_windtempgeo_0p25` | Wind, temp, geopotential height | WAFC Washington | 0.25° |
| `egrr_wafs_windtempgeo_1p25` | Wind, temp, geopotential height | WAFC London | 1.25° |
| `kwbc_wafs_windtempgeo_1p25` | Wind, temp, geopotential height | WAFC Washington | 1.25° |
| `wafs_icing_0p25` | Harmonized icing severity | Blended | 0.25° |
| `wafs_turb_0p25` | Harmonized turbulence severity | Blended | 0.25° |
| `wafs_cb_0p25` | Harmonized cumulonimbus | Blended | 0.25° |
| `egrr_wafs_humidity_0p25` | Relative humidity | WAFC London | 0.25° |
| `kwbc_wafs_humidity_0p25` | Relative humidity | WAFC Washington | 0.25° |
| `egrr_sigwx` | SIGWX forecasts (IWXXM) | WAFC London | N/A |
| `kwbc_sigwx` | SIGWX forecasts (IWXXM) | WAFC Washington | N/A |
| `tac_opmet_reports` | OPMET in TAC format | Global | N/A |
| `iwxxm_opmet_reports` | OPMET in IWXXM format | Global | N/A |

**Note:** The SADIS API has equivalent collections with slightly different naming. Consult the SADIS API User Guide Appendix C for the full permissible `id` codes.

### 2.6 Regional Tiles

Both APIs offer 8 predefined regional tiles for 0.25° data, reducing download volume:

| Tile | Coverage |
|---|---|
| `GLOBAL` | Full global coverage |
| `NAM` | North America |
| `SAM` | South America |
| `EUR_NAT` | Europe and North Atlantic |
| `AFI` | Africa |
| `MID` | Middle East |
| `ASIA_SOUTH` | South and Southeast Asia |
| `ASIA_NORTH` | North Asia |
| `PACIFIC` | Pacific region |

### 2.7 Data Publication Schedule

New data published 4 times daily based on synoptic runs: 0000, 0600, 1200, 1800 UTC.

| Synoptic Run | GRIB2 Typically Available By | SIGWX Available By |
|---|---|---|
| 0000 UTC | ~0435 UTC | ~0600 UTC |
| 0600 UTC | ~1035 UTC | ~1200 UTC |
| 1200 UTC | ~1635 UTC | ~1800 UTC |
| 1800 UTC | ~2235 UTC | ~0000 UTC |

Maximum allowed latency per ICAO: WAFS gridded data available no later than 5 hours after nominal model run time.

### 2.8 Polling & Failover Implementation

```
Algorithm: WAFS Data Acquisition Loop

Every 6 hours (synchronized to 0000/0600/1200/1800 UTC + offset):
  1. Set primary_source = configured_primary (SADIS or WIFS)
  2. Set backup_source = other WAFC
  3. poll_count = 0
  4. WHILE data not complete AND poll_count < max_polls:
       a. Query primary_source for collections metadata
       b. IF connection fails OR auth fails:
            Log warning
            poll_count++
            IF poll_count >= 3:  # 3 failures over ~15+ minutes
              SWITCH to backup_source
              Alert operator: "Failover to {backup_source}"
              CONTINUE from (a) with backup
            WAIT 5 minutes
            CONTINUE
       c. Enumerate items in each required collection
       d. Download items not already in local store
       e. Verify checksums / digital signatures
       f. IF any items missing:
            poll_count++
            WAIT 5 minutes
            CONTINUE
       g. Mark dataset complete
  5. Decode and ingest into data store
  6. Update display with new data
  7. Log acquisition metrics (latency, completeness, source)
```

### 2.9 Known Differences Between SADIS and WIFS APIs

Per WIFS User's Guide v9.0:
- Authentication mechanism differs (API key vs OAuth2)
- Collection naming conventions differ slightly
- OPMET regional groupings may place some airports in different tiles (e.g., Canary Islands ICAO codes start with "G" → found in AFI collection on WIFS, not EUR-NAT)
- SIGWX throttling limits differ (200/day on SADIS SIGWX API vs. included in 5,000/day on WIFS)
- Future: OGC API-EDR Part 2 (Pub/Sub) IOC on WIFS in November 2025, operational 2026

---

## 3. GRIB2 Decoding {#3-grib2-decoding}

### 3.1 Overview

GRIB2 (WMO FM 92-XII) is the format for all WAFS gridded data: wind, temperature, geopotential height, humidity, tropopause, max wind, icing severity, turbulence severity, and cumulonimbus fields.

**Do not write a GRIB2 decoder from scratch.** Use one of the established libraries listed in Section 13.

### 3.2 GRIB2 Message Structure

A GRIB2 message consists of 9 sections:

```
Section 0 — Indicator Section (always 16 octets)
  Octets 1-4:  "GRIB" (ASCII)
  Octets 5-6:  Reserved
  Octet 7:     Discipline (Table 0.0) — 0 = Meteorological
  Octet 8:     Edition number — 2
  Octets 9-16: Total length of message in octets

Section 1 — Identification Section
  Octets 6-7:  Originating centre (Table C-11)
                74 = UK Met Office (EGRR / WAFC London)
                7 = NCEP (KWBC / WAFC Washington)
  Octets 13-19: Reference time (year, month, day, hour, minute, second)
  Octet 20:    Production status (Table 1.3) — 0=Operational, 1=Test
  Octet 21:    Type of data (Table 1.4) — 1=Forecast

Section 2 — Local Use Section (optional)

Section 3 — Grid Definition Section
  Octet 13:    Grid definition template number (Table 3.1)
               0 = Latitude/Longitude (used by WAFS)
  Template 3.0 octets define:
    - Number of points along parallel (Ni)
    - Number of points along meridian (Nj)
    - Latitude/longitude of first and last grid points (in microdegrees, 10^-6)
    - i-direction increment, j-direction increment
    - Scanning mode (Table 3.4)

  For WAFS 0.25° global:
    Ni = 1440, Nj = 721
    First point: 90°N, 0°E → lat=90000000, lon=0
    Last point: 90°S, 359.75°E → lat=-90000000, lon=359750000
    Increment: 250000 (0.25°)

  For WAFS 1.25° global:
    Ni = 288, Nj = 145
    First point: 90°N, 0°E
    Last point: 90°S, 358.75°E
    Increment: 1250000 (1.25°)

Section 4 — Product Definition Section
  Octet 8-9:   Product definition template number (Table 4.0)
               0 = Analysis/forecast at a horizontal level at a point in time
               15 = Spatially processed data (Met Office-proposed, used for some aviation fields)
  Template-specific octets define:
    - Parameter category (Table 4.1) + Parameter number (Table 4.2)
    - Generating process (Table 4.3)
    - Type of first fixed surface (Table 4.5) — flight levels use:
      100 = Isobaric surface (pressure in Pa)
      102 = Mean sea level
      103 = Specified height above ground
    - Scale factor and scaled value of the surface

Section 5 — Data Representation Section
  Octet 10-11: Template number (Table 5.0)
               40 = JPEG2000 packing (used by WAFS)
               0 = Simple packing
  For JPEG2000 (Template 5.40):
    - Reference value (R), binary scale factor (E), decimal scale factor (D)
    - Number of bits for each packed value
    - Type of compression, compression ratio

Section 6 — Bit-Map Section
  Octet 6: Bit-map indicator
           0 = Bit-map follows
           254 = Use previously defined bit-map
           255 = No bit-map (all grid points present)

Section 7 — Data Section
  Contains the actual packed data values
  For JPEG2000: compressed JPEG2000 code stream
  Unpacking formula: Y * 10^D = R + X * 2^E
  where Y = original value, X = encoded integer, R = reference, E = binary scale, D = decimal scale

Section 8 — End Section (always 4 octets: "7777" in ASCII)
```

### 3.3 WAFS-Specific Parameter Table

**Source:** WAFC London GRIB2 Dataset Guide v1.6a (February 2021), available from:
https://www.icao.int/airnavigation/METP/METP%20Reference%20Documents/

| Parameter | Discipline | Category | Number | Unit | Notes |
|---|---|---|---|---|---|
| U-component of wind | 0 | 2 | 2 | m/s | |
| V-component of wind | 0 | 2 | 3 | m/s | |
| Temperature | 0 | 0 | 0 | K | |
| Geopotential height | 0 | 3 | 5 | gpm | |
| Relative humidity | 0 | 1 | 1 | % | |
| Icing severity | 0 | 19 | 37 | categorical | 0=None, 1=Light, 2=Moderate, 3=Severe |
| Turbulence severity (EDR) | 0 | 19 | 31 | m^(2/3)/s | Cube root of EDR |
| CB horizontal extent | 0 | 6 | 25 | % | Proportion of grid box covered |
| CB base | 0 | 6 | 26 | m | Height of CB base |
| CB top | 0 | 6 | 27 | m | Height of CB top |
| Tropopause temperature | 0 | 0 | 0 | K | Fixed surface type 7 (tropopause) |
| Tropopause pressure | 0 | 3 | 0 | Pa | Fixed surface type 7 |
| Max wind U | 0 | 2 | 2 | m/s | Fixed surface type 6 (max wind) |
| Max wind V | 0 | 2 | 3 | m/s | Fixed surface type 6 |
| Max wind pressure | 0 | 3 | 0 | Pa | Fixed surface type 6 |

### 3.4 Generating Process Identifiers

From the WAFC London GRIB2 Dataset Guide:

| Originating Centre | Octet 14 Value | Model |
|---|---|---|
| 74 (Met Office) | Various | UK Global Model deterministic |
| 7 (NCEP) | Various | GFS (Global Forecast System) |

### 3.5 Product Definition Template 4.15 (Spatially Processed)

This template was proposed by the Met Office for aviation products that represent spatial means or maxima over a layer. It extends the standard point-in-time forecast template with additional octets specifying:
- Type of statistical processing (mean, maximum, etc.)
- Type of spatial processing applied
- Number of data points used in processing

**Implementation note:** Many GRIB2 libraries may not natively support PDT 4.15. Ensure your library version is current, or implement custom template handling. ecCodes (ECMWF) has support; verify your version handles it correctly.

### 3.6 JPEG2000 Decompression

WAFS GRIB2 data uses JPEG2000 compression (Data Representation Template 5.40). This is a WMO-approved compression algorithm.

**Libraries:** OpenJPEG (open source), Luratech (commercial, used by WAFC London for encoding).

The decompression pipeline:
1. Extract JPEG2000 code stream from Section 7
2. Decompress to integer array
3. Apply inverse scaling: `Y = (R + X * 2^E) / 10^D`
4. Map to grid defined in Section 3

### 3.7 Flight Level to Pressure Conversion

WAFS data uses pressure levels internally. Flight levels map to pressure approximately via the ICAO Standard Atmosphere:

| Flight Level | Pressure (hPa) | Approx Altitude (ft) |
|---|---|---|
| FL050 | 843.1 | 5,000 |
| FL100 | 696.8 | 10,000 |
| FL140 | 595.2 | 14,000 |
| FL180 | 506.6 | 18,000 |
| FL240 | 389.0 | 24,000 |
| FL300 | 300.9 | 30,000 |
| FL340 | 250.0 | 34,000 |
| FL390 | 197.0 | 39,000 |
| FL450 | 147.5 | 45,000 |
| FL530 | 100.0 | 53,000 |
| FL600 | 72.0 | 60,000 |

For the exact 0.25° dataset, 56 flight levels are provided at 1,000 ft intervals from FL050 to FL600. The mapping uses the ICAO Standard Atmosphere equations defined in ICAO Doc 7488.

### 3.8 Wind Speed/Direction from U/V Components

U (east-west) and V (north-south) wind components are always provided together in the same GRIB2 item. To compute meteorological wind:

```
speed = sqrt(U² + V²)
direction = (270 - atan2(V, U) * 180/π) mod 360
```

Where direction is degrees true, measured clockwise from north — the direction FROM which the wind is blowing.

**Note on units:** GRIB2 wind components are in m/s. Aviation uses knots. Conversion: `knots = m/s × 1.94384`.

---

## 4. BUFR SIGWX Decoding {#4-bufr-sigwx-decoding}

### 4.1 Status and Timeline

BUFR-encoded SIGWX is a **legacy format** being retired by end of 2027. It provided only T+24 forecasts. The replacement is IWXXM (Section 5).

**You must implement BUFR SIGWX decoding for the transition period** (until end of 2027), but the investment should be minimal — use existing libraries.

### 4.2 Reference Documents

- WMO FM 94 BUFR specification: WMO Manual on Codes, Volume I.2
- WAFC SIGWX BUFR Visualisation Developer's Guide (available from AWC): https://aviationweather.gov/progchart/help?page=high
- SADIS User Guide 6th Edition, Part 1, Section 2.3 and Appendix D

### 4.3 SIGWX BUFR Content

Each BUFR bulletin contains a single phenomenon type:

| Bulletin Content | WMO AHL Prefix |
|---|---|
| Jet streams | JUBE / JUSA |
| Turbulence areas | TUBE / TUSA |
| Cumulonimbus areas | CUBE / CUSA |
| Icing areas | IUBE / IUSA |
| Volcanic eruptions | VUBE / VUSA |
| Tropical cyclones | TCBE / TCSA |
| Tropopause | TRBE / TRSA |
| Sandstorms | Not applicable (deprecated) |
| Radioactive releases | Not applicable (rare) |

(`BE` = WAFC London/EGRR, `SA` = WAFC Washington/KKCI)

### 4.4 BUFR Decoding Approach

Use ecCodes (ECMWF) or the NCEP BUFRLIB to decode BUFR messages. The decoded output provides:
- Phenomenon type
- Bounding polygon vertices (lat/lon pairs)
- Vertical extent (base FL, top FL)
- Severity/intensity
- Speed/direction (jet streams)
- Movement information

**Implementation:** Decode to an internal GeoJSON-like structure, then pass to the rendering engine. This same internal structure should be used for IWXXM-decoded SIGWX data.

---

## 5. IWXXM Parsing {#5-iwxxm-parsing}

### 5.1 Overview

IWXXM (ICAO Meteorological Information Exchange Model) is the XML/GML-based format that replaces both TAC and BUFR for aviation meteorological data exchange. It is the **primary format going forward** for both SIGWX and OPMET products.

**Key reference documents:**
- IWXXM schema repository: https://schemas.wmo.int/iwxxm/
- IWXXM GitHub: https://github.com/wmo-im/iwxxm
- Guidelines for Implementation of OPMET Data Exchange Using IWXXM (5th Edition, October 2023)
- SADIS WAFS SIGWX API documentation on EUR SWIM Registry

### 5.2 IWXXM Schema Structure

IWXXM uses XML Schema (XSD) with GML (Geography Markup Language) for spatial features. Key namespaces:

```xml
xmlns:iwxxm="http://icao.int/iwxxm/2025-1"      <!-- Version will evolve -->
xmlns:gml="http://www.opengis.net/gml/3.2"
xmlns:aixm="http://www.aixm.aero/schema/5.1.1"
xmlns:xlink="http://www.w3.org/1999/xlink"
```

**Critical implementation note:** IWXXM schema versions evolve. The version used to encode a message is included in the document. Your parser must handle multiple schema versions gracefully. Store schema files locally and validate against them.

### 5.3 IWXXM SIGWX Product Structure

The SIGWX IWXXM format represents significant weather features as GML geographic objects. The top-level element contains:

```xml
<iwxxm:SIGWXForecast>
  <iwxxm:issuedBy>          <!-- WAFC London or Washington -->
  <iwxxm:validPeriod>       <!-- GML TimePeriod -->
  <iwxxm:phenomenon>        <!-- Collection of weather features -->
    <iwxxm:JetStream>
      <iwxxm:windSpeed>
      <iwxxm:windDirection>
      <iwxxm:flightLevel>
      <iwxxm:geometry>      <!-- GML LineString for jet axis -->
    </iwxxm:JetStream>
    <iwxxm:Turbulence>
      <iwxxm:intensity>     <!-- MODERATE / SEVERE -->
      <iwxxm:baseFlight>
      <iwxxm:topFlight>
      <iwxxm:geometry>      <!-- GML Polygon for turbulence area -->
    </iwxxm:Turbulence>
    <iwxxm:IcingArea>
      <iwxxm:intensity>
      <iwxxm:baseFlight>
      <iwxxm:topFlight>
      <iwxxm:geometry>      <!-- GML Polygon -->
    </iwxxm:IcingArea>
    <iwxxm:CumulonimbusArea>
      <iwxxm:frequency>     <!-- OCCASIONAL / FREQUENT -->
      <iwxxm:topFlight>
      <iwxxm:geometry>      <!-- GML Polygon with scalloped boundary -->
    </iwxxm:CumulonimbusArea>
    <iwxxm:TropicalCyclone>
      <iwxxm:name>
      <iwxxm:position>      <!-- GML Point -->
    </iwxxm:TropicalCyclone>
    <iwxxm:VolcanicActivity>
      <iwxxm:volcanoName>
      <iwxxm:position>      <!-- GML Point -->
    </iwxxm:VolcanicActivity>
    <iwxxm:Tropopause>
      <iwxxm:height>        <!-- Contour lines as GML LineStrings -->
    </iwxxm:Tropopause>
  </iwxxm:phenomenon>
</iwxxm:SIGWXForecast>
```

**Note:** The exact schema structure above is illustrative. Consult the current IWXXM schema version for precise element names, types, and cardinality. The schema is the authoritative source.

### 5.4 IWXXM OPMET Products

| Product | IWXXM Type | Status |
|---|---|---|
| METAR/SPECI | `iwxxm:METAR` / `iwxxm:SPECI` | Operational |
| TAF | `iwxxm:TAF` | Operational |
| SIGMET | `iwxxm:SIGMET` | Operational |
| AIRMET | `iwxxm:AIRMET` | Operational (EUR) |
| VAA | `iwxxm:VolcanicAshAdvisory` | Operational |
| TCA | `iwxxm:TropicalCycloneAdvisory` | Operational |
| Space Weather Advisory | `iwxxm:SpaceWeatherAdvisory` | Operational |
| VONA | `iwxxm:VolcanoObservationNoticeForAviation` | From Nov 2025 |

### 5.5 GML Geometry Handling

IWXXM uses GML for all spatial data. Implement parsing for:

- `gml:Point` — single coordinate (volcanoes, tropical cyclones)
- `gml:LineString` — ordered sequence of coordinates (jet stream axes, tropopause contours)
- `gml:Polygon` — closed area with exterior ring (turbulence, icing, CB areas)
- `gml:MultiPoint`, `gml:MultiPolygon` — collections

**Coordinate format:** GML uses `srsName` to specify the coordinate reference system. IWXXM typically uses `EPSG:4326` (WGS84). Coordinates are in `lat lon` order (note: GML default is lat,lon; this differs from GeoJSON which is lon,lat).

```xml
<gml:pos srsName="urn:ogc:def:crs:EPSG::4326">45.0 -120.5</gml:pos>
<!-- This is latitude 45.0°N, longitude 120.5°W -->
```

### 5.6 AIXM References

IWXXM imports AIXM (Aeronautical Information Exchange Model) for describing aeronautical features like aerodromes and FIRs. Your parser needs to resolve these references, which may point to:
- Aerodrome locations by ICAO code
- FIR boundaries by designator

Maintain a local AIXM database or lookup table mapping ICAO codes to coordinates.

### 5.7 Parser Implementation Strategy

```
Recommended approach:
1. Use a validating XML parser (e.g., lxml in Python, Xerces in Java/C++)
2. Store IWXXM schemas locally (all supported versions)
3. Parse to an internal domain model:
   - SIGWXForecast → collection of WeatherFeature objects
   - Each WeatherFeature has: type, geometry, properties (severity, FL range, etc.)
   - Geometries stored as standard geospatial objects (Shapely/JTS/GEOS)
4. Same internal model used for BUFR-decoded SIGWX (Section 4)
5. Rendering engine consumes the internal model (Section 7)
```

---

## 6. TAC OPMET Parsing {#6-tac-opmet-parsing}

### 6.1 Overview

Traditional Alphanumeric Codes (TAC) remain in use for OPMET products alongside IWXXM. The workstation must parse both formats. TAC parsing is deceptively complex due to regional variations and edge cases.

### 6.2 Reference Documents

- WMO Manual on Codes, No. 306, Volume I.1 (TAC code forms)
- ICAO Annex 3, Appendix 3 (METAR/SPECI template)
- ICAO Annex 3, Appendix 5 (TAF template)
- ICAO Annex 3, Appendix 6 (SIGMET template)
- WMO Publication No. 782 — Aerodrome Reports and Forecasts: Users' Handbook to the Codes

### 6.3 METAR/SPECI Format

```
METAR EGLL 121150Z 24015G25KT 9999 FEW040CB SCT100 17/08 Q1015 NOSIG=
```

Key fields to parse:
- **Station identifier:** 4-letter ICAO code
- **Observation time:** DDHHMMz (UTC)
- **Wind:** dddffGfmfmKT (direction in degrees, speed, gust in knots; or MPS)
- **Visibility:** VVVV in meters (or SM in North America)
- **Weather phenomena:** present weather codes (RA, SN, TS, FG, etc.)
- **Cloud layers:** FEW/SCT/BKN/OVC + height in hundreds of feet + CB/TCU
- **Temperature/dewpoint:** TT/TdTd (Celsius, M prefix for negative)
- **QNH:** Q#### (hPa) or A#### (inches Hg)
- **Trend:** NOSIG / BECMG / TEMPO
- **RVR, runway state, recent weather, wind shear (optional groups)**

**Edge cases to handle:**
- CAVOK (ceiling and visibility OK — replaces visibility, weather, cloud groups)
- AUTO (automated observation)
- Missing groups indicated by ////
- Variable wind direction: VRBffKT or dddVddd
- North American METAR differences (visibility in SM, altimeter in inHg)

### 6.4 TAF Format

```
TAF EGLL 121100Z 1212/1318 24012KT 9999 SCT040 
  BECMG 1215/1217 28018G30KT
  TEMPO 1218/1224 4000 TSRA BKN025CB
  PROB30 TEMPO 1300/1306 0800 FG=
```

Key parsing elements:
- Validity period: YYG1G1/YYG2G2 (day and hours UTC)
- Change groups: BECMG, TEMPO, FM, PROB30/PROB40
- Nesting of change groups within validity periods
- AMD (amendment) and COR (correction) indicators
- CNL (cancellation)

### 6.5 SIGMET Format

```
EGTT SIGMET 3 VALID 121200/121600 EGRR-
EGTT LONDON FIR SEV TURB FCST AT 1200Z N5200 W00200 - N5400 W00400 - 
N5400 W00100 - N5200 W00100 FL300/390 MOV NE 25KT INTSF=
```

Key parsing elements:
- FIR identifier and name
- Phenomenon: TS, SEV TURB, SEV ICE, SEV MTW, VA, TC, etc.
- Location: polygon vertices or reference to latitude/longitude
- Flight level range
- Movement and intensity change (MOV, STNR, INTSF, WKN, NC)
- VA-specific: volcano name, ash layer description

### 6.6 Implementation Recommendation

Use or adapt an existing METAR/TAF parser library rather than writing from scratch:
- **Python:** `python-metar`, `metar` package, or `avwx-engine`
- **Java:** There are several open-source METAR/TAF parsers
- **C/C++:** NCEP decoders

For SIGMET, fewer ready-made parsers exist — you may need to implement a custom parser based on the ICAO Appendix 6 template.

---

## 7. SIGWX Chart Rendering {#7-sigwx-chart-rendering}

### 7.1 Authoritative Rendering Specifications

This is the most compliance-critical part of the workstation. Your SIGWX rendering must be **meteorologically identical** to the WAFC cross-check PNG charts.

**Key reference documents:**
- SIGWX Interpretation Guide v2.01 (Met Office): https://www.metoffice.gov.uk/binaries/content/assets/metofficegovuk/pdf/services/transport/aviation/wafs/sigwx-interpretation-guide-v2.01.pdf
- SADIS API Workstation Software Evaluation Criteria (endorsed WG-MOG/25, June 2024): https://www.icao.int/airnavigation/METP/
- ICAO Annex 3, Appendix 8, Figures A8-1 through A8-3 (SIGWX chart areas)
- WAFC SIGWX BUFR Visualisation Developer's Guide: https://aviationweather.gov/progchart/help?page=high

### 7.2 Mandatory Chart Elements

#### 7.2.1 Legend
Every SIGWX visualization must include:
- **ISSUED BY:** WAFC London or WAFC Washington (EGRR or KKCI)
- **PROVIDED BY:** Organization visualizing the data (your workstation name)
- **Area of coverage:** ICAO chart area designation or custom area
- **Height range:** e.g., FL100–FL450 (SWM) or FL250–FL630 (SWH)
- **Validity time:** Fixed valid time in UTC
- **Notes:** "CHECK SIGMET, ASHTAM AND NOTAM FOR VA"

**Critical rule:** If the operator modifies any meteorological parameter, references to the issuing WAFC must be automatically removed from the legend.

#### 7.2.2 Turbulence Areas
- Bounded by **thick dashed lines**
- Each area has a **reference number** linking to a key showing:
  - Intensity: MOD (moderate) or SEV (severe)
  - Base flight level
  - Top flight level
- Alternative: Direct "call-out" labels placed near the area
- Grey shading is optional but recommended for filled areas

#### 7.2.3 Cumulonimbus Areas
- Bounded by **scalloped lines** (series of small arcs)
- Labeled with frequency: ISOL (isolated), OCNL (occasional), FRQ (frequent)
- CB top flight level indicated
- **Important:** EMBD (embedded) CB types are no longer included in SIGWX forecasts as of January 2025. Users should reference the WAFS gridded CB datasets instead.

#### 7.2.4 Icing Areas
- Depicted with a **distinct line style** differentiable from CB areas
- On colour displays: different colour from CB
- On monochrome: different dash pattern from CB
- Labeled with severity (MOD/SEV) and flight level range

#### 7.2.5 Jet Streams
- Shown as **standard wind barb symbols** on a line representing the jet axis
- Core speed annotation (in knots)
- Core flight level annotation
- Wind barbs follow standard convention: half barb = 5kt, full barb = 10kt, pennant = 50kt
- Spacing of barbs along the axis should be sufficient to show direction without clutter

#### 7.2.6 Tropopause Height
- Shown as **thin dotted blue contour lines**
- Each contour labeled with a flight level
- Where contours are close together, indicates rapid tropopause height change (often coincides with jet streams)

#### 7.2.7 Tropical Cyclones
- Standard ICAO tropical cyclone symbol at position
- Name and/or designator labeled

#### 7.2.8 Volcanic Eruptions
- Standard ICAO volcano symbol at position
- Volcano name labeled

### 7.3 Chart Areas (ICAO Standard)

From ICAO Annex 3, Appendix 8:

| Area | Projection | Coverage |
|---|---|---|
| Global (Mercator) | Equatorial Mercator | Full global, truncated at ~70°N/S |
| North Polar | Polar Stereographic (North) | North of ~25°N |
| South Polar | Polar Stereographic (South) | South of ~25°S |
| ICAO Areas A through M | Regional Mercator/Lambert | As defined in Annex 3 Fig A8-1 |

### 7.4 Multi-Timestep Animation

The workstation must animate SIGWX from T+6 to T+48 at 3-hour intervals (15 frames):

```
Implementation:
1. Parse all 15 SIGWX IWXXM timesteps into the internal domain model
2. Build a frame buffer with one rendered SIGWX chart per timestep
3. Time slider UI control:
   - Discrete steps: T+6, T+9, T+12, ..., T+48
   - Play/pause button with adjustable speed (0.5s to 3s per frame)
   - Current timestep prominently displayed (UTC valid time)
4. Frame interpolation is NOT appropriate for SIGWX features (these are
   discrete forecast snapshots, not continuous data)
5. Optional: "onion skin" mode showing 2-3 adjacent timesteps with
   decreasing opacity to show feature movement
```

### 7.5 Colour Conventions

While ICAO does not mandate specific RGB values, the following conventions are widely used and expected by the evaluation criteria:

| Feature | Suggested Colour | Notes |
|---|---|---|
| Turbulence areas | Orange/amber fill, dark outline | Graduated intensity |
| CB areas | Red/magenta scalloped outline | |
| Icing areas | Blue/cyan | Must be distinct from CB |
| Jet streams | Green or dark blue lines | With wind barbs |
| Tropopause | Light blue dotted lines | |
| Tropical cyclones | Red symbol | |
| Volcanoes | Red/brown symbol | |
| Background geography | Light grey coastlines/borders | Non-distracting |

---

## 8. Gridded Data Visualization {#8-gridded-data-visualization}

### 8.1 Wind Barb Plotting

Standard meteorological wind barbs at selected grid points:
- Half barb (5 kt): short line
- Full barb (10 kt): long line
- Pennant (50 kt): filled triangle
- Calm (< 3 kt): circle with no barbs
- Barbs on left side of staff in Northern Hemisphere, right side in Southern Hemisphere

Thin grid points to avoid overlapping barbs (e.g., plot every 2nd or 4th point depending on zoom level).

### 8.2 Contouring Algorithms

For temperature, geopotential height, humidity, and hazard fields:
- Use a marching squares or marching cubes variant for isoline generation
- Standard contour intervals:
  - Temperature: 5°C intervals
  - Geopotential height: 60m (or 6 dam) intervals
  - Wind speed (isotach): 20kt intervals for jet analysis
  - Icing/turbulence severity: follow WAFS categorical thresholds

### 8.3 Specific Leg Wind Calculation

A key operational function: computing route-specific winds for flight planning.

```
Algorithm: Leg Wind Computation
Input: Route defined as sequence of waypoints [(lat1,lon1), (lat2,lon2), ...], flight level
Output: For each leg, headwind/tailwind component and crosswind component

For each leg (P1 → P2):
  1. Compute great circle track from P1 to P2
  2. At regular intervals along the leg (e.g., every 1°):
     a. Bilinearly interpolate U and V wind components from the GRIB2 grid
     b. Convert to speed and direction
     c. Compute headwind component = speed × cos(wind_dir - track)
     d. Compute crosswind component = speed × sin(wind_dir - track)
  3. Average components along the leg
  4. Report: average ground-relative wind components for flight planning
```

### 8.4 Vertical Cross-Section

Along a user-defined route, display a vertical cross-section of any parameter:
- X-axis: distance along route
- Y-axis: flight level (FL050 to FL600)
- Color fill: wind speed, temperature, turbulence severity, icing severity
- Overlay: tropopause height line

Requires interpolation across the grid at multiple flight levels for each point along the route.

---

## 9. Map Projections & Coordinate Systems {#9-map-projections}

### 9.1 Required Projections

| Projection | Use Case | Parameters |
|---|---|---|
| Equatorial Mercator | Global SIGWX overview | Standard parallel at equator |
| Polar Stereographic (North) | Arctic/North Atlantic operations | True at 60°N, centered on North Pole |
| Polar Stereographic (South) | Antarctic/Southern Hemisphere | True at 60°S, centered on South Pole |
| Lambert Conformal Conic | Mid-latitude regional charts | Two standard parallels (configurable) |

### 9.2 Implementation Notes

- **Datum:** WGS84 (EPSG:4326) for all WAFS data
- **International Date Line:** Grid data wraps at 360°/0°. Rendering must handle features that cross the IDL (e.g., Pacific jet streams, CB areas). Split polygons at the antimeridian and render both parts.
- **Pole handling:** GRIB2 data includes grid points at both poles. SIGWX features may extend to polar regions. Polar stereographic projections must render correctly up to the pole.
- **Hemisphere conventions:** Wind barbs flip orientation in Southern Hemisphere. Tropopause height labels and SIGWX features follow the same conventions in both hemispheres.

### 9.3 Recommended Libraries

- **PROJ:** De facto standard for coordinate transformations (https://proj.org/)
- **GDAL/OGR:** Geospatial data handling, includes GRIB2 driver
- **Mapbox GL / Leaflet / OpenLayers:** For web-based rendering
- **Custom OpenGL/Vulkan:** For high-performance native rendering

---

## 10. Data Storage & Lifecycle {#10-data-storage}

### 10.1 Retention Requirements

| Data Type | Minimum Retention | Source |
|---|---|---|
| GRIB2 gridded data | 36 hours | SADIS deletion policy |
| OPMET (METAR/TAF/SIGMET) | 28 days | ICAO Annex 3, 9.3.4 |
| Flight documentation | 30 days | ICAO Annex 3, 9.3.4 |
| GAMET | 23 hours | SADIS deletion policy |
| SIGWX IWXXM/BUFR | 36 hours | Operational need |
| Audit/access logs | 90 days minimum | Security best practice |

### 10.2 Storage Architecture

```
Recommended: Hybrid approach
- Time-series database (e.g., TimescaleDB, InfluxDB) for OPMET observations
- File system with structured directory tree for GRIB2 files:
    /data/grib2/{source}/{run_time}/{parameter}/{tile}/
- Document store or XML database for IWXXM products
- SQLite/PostgreSQL for metadata index (parameter, time, level, location → file path)
```

### 10.3 Data Currency Tracking

Maintain a currency table:
```sql
CREATE TABLE data_currency (
  collection_id  TEXT,
  source         TEXT,  -- 'SADIS' or 'WIFS'
  run_time       TIMESTAMP,
  acquired_at    TIMESTAMP,
  items_expected INTEGER,
  items_received INTEGER,
  complete       BOOLEAN,
  staleness_warning BOOLEAN DEFAULT FALSE
);
```

Trigger staleness warnings when:
- Data age exceeds configured threshold (default: 8 hours for gridded, 2 hours for OPMET)
- Expected items not received after 3 re-polls

---

## 11. Failover & Redundancy Logic {#11-failover}

### 11.1 Primary/Backup Configuration

The system must support configurable primary/backup assignment:
- SADIS primary / WIFS backup (typical for EUR, AFI, MID, ASIA regions)
- WIFS primary / SADIS backup (typical for NAM, CARSAM regions)
- APAC shared region: user choice

### 11.2 Failover Triggers

| Trigger | Action | Recovery |
|---|---|---|
| API authentication failure | Retry with fresh token/key; if persists, failover | Auto-recover on next successful auth |
| HTTP 5xx from primary API | Retry 3 times with backoff; then failover | Auto-recover on next polling cycle |
| Incomplete dataset after 3 re-polls | Failover + operator alert | Auto-recover when primary produces complete data |
| Certificate/TLS error | Failover + operator alert | Manual intervention may be needed |
| Data quality issue (checksum mismatch) | Discard corrupted data; re-fetch; if persists, failover | Auto-recover on re-fetch |

### 11.3 Failover Transparency

Both WAFCs produce interchangeable data. When failover occurs:
- The operator is notified (visual indicator + log entry)
- The legend on visualizations changes to reflect the actual data source
- No manual action required — fully automatic
- System periodically tests primary source and reverts when available

---

## 12. External Reference Documents {#12-external-references}

### 12.1 ICAO Documents (Regulatory)

| Document | Title | Key Sections |
|---|---|---|
| ICAO Annex 3 | Meteorological Service for International Air Navigation (Amd 82) | Ch. 3 (WAFS), Ch. 9 (Service for operators/crew), App. 2, App. 8 |
| PANS-MET (Doc 10157) | Procedures for Air Navigation Services — Meteorology | Operational from Nov 2025 |
| Doc 9750 | Global Air Navigation Plan, 7th Edition | ASBU framework, AMET blocks |
| Doc 10039 | Manual on SWIM Concept | MET-SWIM architecture |
| Doc 9855 | Guidelines on Use of Public Internet for Aeronautical Applications | Security/reliability requirements |
| Doc 7488 | Manual of the ICAO Standard Atmosphere | FL-to-pressure conversion |

### 12.2 WMO Documents (Data Formats)

| Document | Title | Use |
|---|---|---|
| WMO No. 306, Vol I.2 | Manual on Codes — Binary Codes (FM 92 GRIB, FM 94 BUFR) | GRIB2 and BUFR specifications |
| WMO No. 306, Vol I.1 | Manual on Codes — Alphanumeric Codes | TAC METAR/TAF/SIGMET |
| WMO No. 782 | Aerodrome Reports and Forecasts: Users' Handbook | Practical TAC parsing guide |
| WMO No. 386 | Manual on the GTS, Part II, Att. II-5 | WMO AHL data designators |

### 12.3 WAFC-Specific Technical Documents

| Document | Source | URL/Access |
|---|---|---|
| WAFC London GRIB2 Dataset Guide v1.6a | Met Office/ICAO | ICAO METP reference documents |
| SIGWX Interpretation Guide v2.01 | Met Office | metoffice.gov.uk/aviation |
| SADIS User Guide 6th Edition (Parts 1 & 2) | Met Office/ICAO | ICAO METP reference documents |
| SADIS API User Guide v1.05 | Met Office | Available upon SADIS registration |
| SADIS API Evaluation Criteria (June 2024) | Met Office/ICAO MOG | ICAO METP reference documents |
| SADIS API Evaluation Guide v1.0 | Met Office/ICAO MOG | ICAO METP reference documents |
| WIFS User's Guide v9.0 | NOAA/AWC | aviationweather.gov/wifs/users_guide |
| WAFS Change Implementation Notice v49 | ICAO | ICAO METP reference documents |
| WAFS 10-Year Plan / Future Delivery Poster | ICAO | ICAO METP reference documents |

### 12.4 Standards (Data Exchange)

| Standard | Organisation | Use |
|---|---|---|
| OGC API-EDR | OGC | API query framework |
| OGC API-EDR Part 2: PubSub | OGC | Future event-driven data delivery |
| IWXXM schemas | WMO/ICAO | XML data model |
| GML 3.2 (ISO 19136) | OGC/ISO | Geographic features |
| AIXM 5.1.1 | EUROCONTROL/FAA | Aeronautical features |

---

## 13. Open-Source Libraries & Tools {#13-libraries}

### 13.1 GRIB2 Processing

| Library | Language | Notes |
|---|---|---|
| **ecCodes** (ECMWF) | C/Fortran/Python | Recommended primary library. Handles GRIB2 + BUFR. Actively maintained. Supports PDT 4.15. https://confluence.ecmwf.int/display/ECC |
| **wgrib2** (NCEP) | C | Command-line tool + library. Very fast. https://www.cpc.ncep.noaa.gov/products/wesley/wgrib2/ |
| **NCEPLIBS-g2c** | C | Low-level GRIB2 encode/decode library. https://github.com/NOAA-EMC/NCEPLIBS-g2c |
| **cfgrib** | Python | xarray backend for GRIB via ecCodes. https://github.com/ecmwf/cfgrib |
| **GDAL** | C++/Python/Java | GRIB2 raster driver. Good for reprojection. https://gdal.org/ |

### 13.2 BUFR Processing

| Library | Language | Notes |
|---|---|---|
| **ecCodes** | C/Python | Also handles BUFR. Same library as GRIB2. |
| **NCEPLIBS-bufr** | Fortran/C | NCEP's BUFR library. https://github.com/NOAA-EMC/NCEPLIBS-bufr |

### 13.3 XML/GML/IWXXM

| Library | Language | Notes |
|---|---|---|
| **lxml** | Python | Fast XML parser with schema validation |
| **Xerces** | Java/C++ | Validating XML parser |
| **OGR/GDAL** | C++/Python | GML geometry reading |
| **Shapely** / **JTS** / **GEOS** | Python/Java/C++ | Geometry operations |

### 13.4 METAR/TAF Parsing

| Library | Language | Notes |
|---|---|---|
| **python-metar** | Python | https://github.com/python-metar/python-metar |
| **avwx-engine** | Python | Comprehensive aviation weather parser. https://github.com/avwx-rest/avwx-engine |

### 13.5 Geospatial & Mapping

| Library | Language | Notes |
|---|---|---|
| **PROJ** | C/Python | Coordinate transformations |
| **MapLibre GL** | JS/Native | Open-source map rendering |
| **Leaflet** | JavaScript | Lightweight web maps |
| **Matplotlib + Cartopy** | Python | Scientific map plotting |
| **OpenLayers** | JavaScript | Full-featured web GIS |

### 13.6 JPEG2000

| Library | Language | Notes |
|---|---|---|
| **OpenJPEG** | C | Open-source JPEG2000 codec. Used by ecCodes. https://www.openjpeg.org/ |

---

## 14. Test Vectors & Validation {#14-test-vectors}

### 14.1 GRIB2 Validation

1. Download sample WAFS GRIB2 files from WIFS (requires account)
2. Decode using wgrib2 and your workstation decoder in parallel
3. Compare: every grid point value must be bit-identical
4. Verify parameter identification (discipline/category/number) matches expected
5. Verify grid geometry (Ni, Nj, first/last point, increment) matches specification

```bash
# Using wgrib2 to dump reference values:
wgrib2 sample.grib2 -V           # Verbose metadata
wgrib2 sample.grib2 -csv output.csv  # All values as CSV for comparison
wgrib2 sample.grib2 -grid         # Grid specification
```

### 14.2 SIGWX Validation

The WAFCs provide cross-check PNG charts (one Mercator global view, two polar stereographic views) for every model run. These are NOT for operational use but for validating that your SIGWX rendering matches:

1. Download the cross-check PNG for a given timestep
2. Render the same timestep from IWXXM (or BUFR) data in your workstation
3. Visually compare: feature positions, symbology, labels must match
4. Automated comparison: extract feature polygons/lines and compute geometric difference

### 14.3 OPMET Validation

1. Retrieve a set of METARs for well-known aerodromes (EGLL, KJFK, RJTT, YSSY, FAOR) — at least 5 regions
2. Parse in both TAC and IWXXM formats
3. Verify: wind, visibility, weather, cloud, temperature, pressure all decode identically from both formats
4. Edge cases to test: CAVOK, AUTO, missing groups, variable wind, RVR, trend forecast

### 14.4 End-to-End Acquisition Test

```
Test procedure:
1. Configure workstation with valid SADIS and WIFS credentials
2. Wait for next model run (0000/0600/1200/1800 UTC)
3. Verify: complete gridded dataset acquired within 60 seconds of availability
4. Verify: all 15 SIGWX timesteps (T+6 to T+48) acquired and renderable
5. Verify: OPMET data current for configured aerodromes
6. Simulate primary API outage (block network to primary)
7. Verify: automatic failover to backup within 2 minutes
8. Verify: data continuity — no gap in displayed products
9. Restore primary API access
10. Verify: automatic revert to primary source
```

### 14.5 Performance Benchmarks

Run all benchmarks with recommended hardware from the Technical Specification:

| Test | Method | Pass Criterion |
|---|---|---|
| Full model run download | Time from first API call to all data decoded | ≤ 60 seconds |
| Single GRIB2 field decode | Time to decode one global 0.25° field | ≤ 5 seconds |
| SIGWX IWXXM parse + render | Time from raw XML to interactive display | ≤ 10 seconds per timestep |
| Map interaction (pan/zoom) | Measure frame latency during continuous pan | ≤ 100ms (≥10 fps) |
| SIGWX animation | Frame rate during continuous playback | ≥ 5 fps |
| OPMET search | Time to retrieve and display regional OPMET list | ≤ 3 seconds |
| Briefing package generation | Full route briefing compilation to PDF | ≤ 30 seconds |

---

## Appendix A: WIFS API Collection Reference

### Gridded Data Collections

| Collection | WAFC | Res | Parameters | Items |
|---|---|---|---|---|
| `egrr_wafs_windtempgeo_0p25` | London | 0.25° | U, V, T, Geopotential | Per-FL and per-timestep GRIB2 |
| `kwbc_wafs_windtempgeo_0p25` | Washington | 0.25° | U, V, T, Geopotential | Per-FL and per-timestep GRIB2 |
| `egrr_wafs_windtempgeo_1p25` | London | 1.25° | U, V, T, Geopotential | Per-FL and per-timestep GRIB2 |
| `kwbc_wafs_windtempgeo_1p25` | Washington | 1.25° | U, V, T, Geopotential | Per-FL and per-timestep GRIB2 |
| `egrr_wafs_humidity_0p25` | London | 0.25° | Relative humidity | Per-FL and per-timestep GRIB2 |
| `kwbc_wafs_humidity_0p25` | Washington | 0.25° | Relative humidity | Per-FL and per-timestep GRIB2 |
| `wafs_icing_0p25` | Harmonized | 0.25° | Icing severity | Per-FL and per-timestep GRIB2 |
| `wafs_turb_0p25` | Harmonized | 0.25° | Turbulence severity (EDR) | Per-FL and per-timestep GRIB2 |
| `wafs_cb_0p25` | Harmonized | 0.25° | CB extent, base, top | Per-timestep GRIB2 |

### SIGWX Collections

| Collection | WAFC | Format | Timesteps |
|---|---|---|---|
| `egrr_sigwx` | London | IWXXM XML | T+6 to T+48, 3-hourly |
| `kwbc_sigwx` | Washington | IWXXM XML | T+6 to T+48, 3-hourly |

### OPMET Collections

| Collection | Format | Coverage |
|---|---|---|
| `tac_opmet_reports` | TAC text | Global + regional subsets |
| `iwxxm_opmet_reports` | IWXXM XML | Global + regional subsets |

Regional OPMET subsets: NAM, CARSAM, EUR-NAT, AFI, MID, ASIAPAC

---

## Appendix B: GRIB2 Section Structure Quick Reference

```
┌─────────────────────────────────────────┐
│ Section 0: Indicator (16 bytes fixed)   │
│   "GRIB" + reserved + discipline +      │
│   edition(2) + total message length     │
├─────────────────────────────────────────┤
│ Section 1: Identification               │
│   Centre, sub-centre, tables version,   │
│   reference time, production status     │
├─────────────────────────────────────────┤
│ Section 2: Local Use (optional)         │
├─────────────────────────────────────────┤
│ Section 3: Grid Definition              │  ┐
│   Template 3.0 for lat/lon grid         │  │
│   Ni, Nj, first/last point, increment  │  │
├─────────────────────────────────────────┤  │
│ Section 4: Product Definition           │  │ Repeatable
│   PDT 4.0 or 4.15                       │  │ group
│   Parameter, level, forecast time       │  │
├─────────────────────────────────────────┤  │
│ Section 5: Data Representation          │  │
│   DRT 5.40 (JPEG2000) or 5.0 (simple)  │  │
│   R, E, D, bits per value               │  │
├─────────────────────────────────────────┤  │
│ Section 6: Bit-Map (or indicator 255)   │  │
├─────────────────────────────────────────┤  │
│ Section 7: Data (packed values)         │  ┘
├─────────────────────────────────────────┤
│ Section 8: End ("7777", 4 bytes fixed)  │
└─────────────────────────────────────────┘
```

---

## 15. Advisory Product Display (VAA, TCA, SWx, Nuclear) {#15-advisory-products}

### 15.1 Overview

The SADIS API evaluation (Criteria 4b, 5b, 8) requires the workstation to handle a broader set of advisory products beyond standard SIGWX and OPMET. These are distinct from SIGWX chart elements — they are standalone advisory messages and graphics issued by specialised centres.

### 15.2 Required Advisory Product Types

| Product | Issuing Centres | TAC Format | IWXXM Format | Graphic (PNG) |
|---|---|---|---|---|
| Volcanic Ash Advisory (VAA) | 9 VAACs worldwide | Yes | `iwxxm:VolcanicAshAdvisory` | Yes (PNG from VAACs) |
| Tropical Cyclone Advisory (TCA) | TCACs (e.g., RSMC Tokyo) | Yes | `iwxxm:TropicalCycloneAdvisory` | Yes (PNG from TCACs) |
| Space Weather Advisory (SWx) | Designated SWx centres | Yes | `iwxxm:SpaceWeatherAdvisory` | No |
| ASHTAM | States/CAAs | NOTAM format | N/A (NOTAM system) | No |
| NOTAM relating to volcanic ash | States/CAAs | NOTAM format | N/A | No |
| Nuclear emergency / radioactive release | States | Text advisory | N/A | No |

### 15.3 VAA/TCA Advisory Graphics

The evaluation (Criterion 8) specifically requires display of VAA and TCA **graphic charts** — these are PNG images produced by the VAACs and TCACs and distributed via SADIS/WIFS.

**Implementation:**
- Download PNG advisory graphics from the SADIS/WIFS API as they become available
- Display in a dedicated advisory viewer panel or overlay on the main map
- Must be viewable at full resolution with pan/zoom
- The 9 VAACs are: London, Toulouse, Montreal, Washington, Buenos Aires, Darwin, Tokyo, Wellington, Anchorage
- TCA graphics are currently limited (e.g., Japan/RSMC Tokyo) but expanding

### 15.4 Space Weather Advisories

Space weather advisories are a newer ICAO product addressing impacts on HF communications, GNSS navigation, and radiation exposure at flight levels. The workstation must:
- Receive and display SWx advisories in both TAC and IWXXM formats
- Display in list/report form sortable by type and region
- Trigger operator alerting (see Section 16)

### 15.5 ASHTAM and Volcanic Ash NOTAM

These are NOTAM-format messages specifically related to volcanic ash contamination at or near aerodromes. They are distributed as part of the OPMET data stream.
- Parse as NOTAM text products
- Display in advisory list alongside VAA messages
- Sortable by FIR and aerodrome

### 15.6 Nuclear Emergency Advisories

Radioactive release messages are rare but must be handled:
- Parse text advisory format
- Display in alert list
- Trigger high-priority operator alert (see Section 16)

---

## 16. Operator Alerting Subsystem {#16-alerting}

### 16.1 Overview

**Evaluation Criteria 9a and 9b** require the workstation to actively alert operators when advisory-type products are received. This is NOT passive display — the system must push notifications.

### 16.2 Alert Trigger Table

| Product Type | TAC Trigger (Criterion 9a) | IWXXM Trigger (Criterion 9b) | Priority |
|---|---|---|---|
| Volcanic Ash Advisory | New VAA message received | New `iwxxm:VolcanicAshAdvisory` | HIGH |
| Tropical Cyclone Advisory | New TCA message received | New `iwxxm:TropicalCycloneAdvisory` | HIGH |
| Space Weather Advisory | New SWx message received | New `iwxxm:SpaceWeatherAdvisory` | HIGH |
| ASHTAM / VA NOTAM | New ASHTAM or VA-related NOTAM | N/A (NOTAM system) | HIGH |
| Nuclear Emergency Advisory | New radioactive release message | N/A | CRITICAL |
| SIGMET (operational) | New SIGMET for configured FIRs | New `iwxxm:SIGMET` for configured FIRs | MEDIUM |

### 16.3 Alert Mechanism Specification

```
Alert System Architecture:

1. INCOMING DATA MONITOR
   - Runs as a background service within the data acquisition layer
   - On each OPMET data refresh cycle (every 5 minutes per Criterion 1a):
     a. Compare newly received messages against previously seen message IDs
     b. For each NEW message, check message type against alert trigger table
     c. If match: generate alert event

2. ALERT EVENT PROCESSING
   - Each alert event contains:
     - Timestamp (UTC)
     - Product type (VAA, TCA, SWx, ASHTAM, Nuclear, SIGMET)
     - Priority level (CRITICAL, HIGH, MEDIUM)
     - Source (issuing centre / FIR)
     - Brief summary (extracted from message)
     - Link to full message display
   
3. ALERT PRESENTATION
   - Visual: Prominent notification banner/popup on all active displays
     - CRITICAL: Full-screen modal requiring acknowledgement
     - HIGH: Persistent banner with audible tone, auto-dismiss after acknowledgement
     - MEDIUM: Badge/counter on alert panel, no modal
   - Audible: Configurable alert tones (distinct for each priority level)
   - Alert history: Scrollable log of all alerts with timestamps and acknowledgement status
   
4. ALERT CONFIGURATION
   - Configurable FIR filter: only alert for SIGMETs in operationally relevant FIRs
   - Configurable product filter: enable/disable alerts per product type
   - Cannot disable CRITICAL-level alerts (nuclear emergency)
   - Alert sound volume control
   - Multi-seat: alerts propagate to all connected operator workstations

5. SELF-CERTIFICATION NOTE
   The evaluation acknowledges that some advisory types (nuclear emergency, 
   certain SWx events) may have no available test bulletins. Self-certification 
   with demonstrated code paths is acceptable per the evaluation criteria notes.
```

### 16.4 Testing Approach

- Use historical VAA/TCA messages (readily available from SADIS/WIFS archives)
- For SWx: use any available Space Weather Advisory from the OPMET stream
- For nuclear/ASHTAM: create synthetic test messages matching the expected format; document self-certification per evaluation note
- Demonstrate: alert appears within 30 seconds of message ingestion

---

## 17. IWXXM Human-Readable Rendering {#17-iwxxm-human-readable}

### 17.1 Overview

**Evaluation Criteria 5a and 5b** require IWXXM products to be displayed in "human readable form." This means the raw XML must be transformed into a presentation that an operator can read as naturally as TAC text — not an XML tree view.

### 17.2 Rendering Strategy

```
IWXXM → Human-Readable Pipeline:

1. Parse IWXXM XML into internal domain objects (Section 5.7)
2. Apply product-specific rendering templates:
   - METAR → structured single-line summary matching familiar METAR layout
   - TAF → structured multi-line with change groups indented
   - SIGMET → natural language summary with area description
   - VAA → structured advisory format with ash layer details
   - TCA → structured advisory format with TC position/track
   - SWx → structured advisory format with impact descriptions
3. Include all decoded values with proper units and abbreviations
4. Preserve ICAO-standard terminology and abbreviations
5. Display alongside or in place of raw TAC when IWXXM is the source
```

### 17.3 Example: IWXXM METAR Rendered Human-Readable

From IWXXM XML, render as:
```
METAR EGLL 12/03/2026 11:50 UTC
Wind: 240° at 15 kt, gusting 25 kt
Visibility: 10 km or more
Weather: -
Cloud: FEW at 4,000 ft (CB), SCT at 10,000 ft
Temperature: 17°C / Dewpoint: 08°C
QNH: 1015 hPa
Trend: No significant change
```

### 17.4 Example: IWXXM SIGMET Rendered Human-Readable

```
SIGMET 3 — EGTT LONDON FIR
Valid: 12/03/2026 12:00–16:00 UTC
Issued by: EGRR (Met Office)
Phenomenon: SEVERE TURBULENCE
Observed at: 12:00 UTC
Area: N52°00' W002°00' – N54°00' W004°00' – N54°00' W001°00' – N52°00' W001°00'
Flight levels: FL300 to FL390
Movement: NE at 25 kt
Intensity: Intensifying
```

### 17.5 Sorting and Filtering Requirements

Both TAC (Criterion 4) and IWXXM (Criterion 5) OPMET displays must support:
- **Sort by data type:** Group all METARs together, all TAFs together, etc.
- **Sort by location:** Alphabetical by ICAO code or aerodrome name
- **Sort by issuing country:** Requires ICAO code → country lookup (see Section 20)
- **Sort by FIR:** Requires ICAO code → FIR mapping (see Section 20)
- **Filter by region:** CARSAM, NAM, EUR/NAT, MID, ASIAPAC
- **Filter by individual airport:** Enter ICAO 4-letter code
- **Filter by individual FIR:** Enter FIR designator

---

## 18. ICAO Fixed SIGWX Chart Areas {#18-icao-chart-areas}

### 18.1 Overview

**Evaluation Criteria 2a and 3a** require the workstation to display data as the "fixed ICAO chart areas" (A, B, B1, C, D, E, F, G, H, I, J, K, M). These are predefined geographic extents specified in ICAO Annex 3, Appendix 8 (Figures A8-1 through A8-3).

### 18.2 ICAO SIGWX Chart Area Definitions

| Area | Description | Projection | Approximate Bounds |
|---|---|---|---|
| A | North & South America (equatorial) | Mercator | 70°N–55°S, 140°W–020°W |
| B | Atlantic / Europe / Africa (equatorial) | Mercator | 70°N–55°S, 060°W–070°E |
| B1 | Americas / Atlantic / Europe / Africa (wide equatorial) | Mercator | 70°N–55°S, 140°W–070°E |
| C | Western Pacific / East Asia (equatorial) | Mercator | 70°N–55°S, 060°E–150°E |
| D | Eastern Pacific / Americas (equatorial) | Mercator | 70°N–55°S, 100°E–170°W |
| E | Europe / North Atlantic (mid-latitude) | Mercator | 70°N–25°N, 070°W–050°E |
| F | Pacific / East Asia (equatorial) | Mercator | 40°N–30°S, 080°E–180° |
| G | Middle East / South Asia | Mercator | 50°N–15°S, 020°E–090°E |
| H | Central Africa / Indian Ocean | Mercator | 25°N–50°S, 010°W–070°E |
| I | South Pacific / Australia | Mercator | 10°N–55°S, 090°E–170°W |
| J | South Pacific / Antarctica | Polar Stereo (South) | South of ~25°S, Pacific sector |
| K | Southern Indian Ocean / Antarctica | Polar Stereo (South) | South of ~25°S, Indian Ocean sector |
| M | North Polar | Polar Stereo (North) | North of ~25°N |

**Note:** The exact boundary coordinates vary slightly by source. The authoritative definitions are in ICAO Annex 3, Appendix 8. Implement these as named presets in the map view — the operator selects "Area B1" and the view snaps to the predefined extent and projection.

### 18.3 Implementation

```
Chart Area Presets:
- Store as named configuration objects: { name, projection, bounds, margins }
- Map projection switches automatically based on area selection
  (Mercator for equatorial areas A–I, Polar Stereographic for J/K/M)
- "Snap to area" button or dropdown in the toolbar
- When displaying as a fixed area, the legend must identify the ICAO area code
- User must also be able to define custom areas (free pan/zoom) — 
  this is separate from the fixed presets
```

---

## 19. OPMET Geographic Display & Auto-Refresh {#19-opmet-map-display}

### 19.1 Overview

**Evaluation Criteria 6a, 6b, 7a, 7b** require OPMET data to be displayed on a map view with specific capabilities. The evaluation tests TAC-sourced and IWXXM-sourced map displays separately.

### 19.2 METAR/SPECI/TAF on Map (Criteria 6a, 7a)

**Requirements:**
- Plot METAR/SPECI/TAF at aerodrome positions on the map
- "Key elements of relevance" — at minimum: flight category, wind, visibility, significant weather
- **Colour coding:** Apply flight category colour coding:
  - VFR (ceiling > 3,000 ft AND visibility > 5 SM): Green
  - MVFR (ceiling 1,000–3,000 ft OR visibility 3–5 SM): Blue
  - IFR (ceiling 500–1,000 ft OR visibility 1–3 SM): Red
  - LIFR (ceiling < 500 ft OR visibility < 1 SM): Magenta
- **Automatic update:** When new OPMET data is received (every 5-minute polling cycle), the map display must refresh automatically without operator intervention. This is explicitly tested.
- Click on a station dot to see full METAR/TAF details in a popup or sidebar panel

### 19.3 SIGMET and Special AIREP on Map (Criteria 6b, 7b)

**Requirements:**
- Plot SIGMET areas as shaded polygons on the map at the correct geographic location
- **Special Air Reports (Special AIREPs)** must be plotted at their reported position — this is a specific evaluation requirement that our original spec missed
  - Special AIREPs contain: aircraft position (lat/lon), flight level, phenomenon observed (turbulence, icing, etc.)
  - Plot as a point symbol with phenomenon indicator at the reported position
- Colour coding by phenomenon type:
  - Turbulence: Amber/orange
  - Icing: Blue/cyan
  - Volcanic ash: Red/brown
  - Thunderstorms: Red/magenta
  - Other: Yellow
- Show key elements: phenomenon type, severity, flight level range, movement
- Both TAC-decoded and IWXXM-decoded SIGMETs must produce the same map display

### 19.4 Dual Data Path Requirement

The evaluation tests map display from TAC data (Criteria 6a, 6b) and from IWXXM data (Criteria 7a, 7b) **separately**. The workstation must demonstrate that both data paths lead to correct, equivalent map visualizations. Implementation strategy:

```
Both TAC and IWXXM parsing pipelines → same internal domain model → same rendering engine

The evaluation tests:
- "Show me METARs on map from TAC data" → Criterion 6a
- "Show me METARs on map from IWXXM data" → Criterion 7a
Both must produce functionally equivalent displays.

Implementation: parse both formats into the same OPMETObservation/OPMETForecast 
internal objects, which the map renderer consumes. The renderer doesn't know or care 
whether the source was TAC or IWXXM.
```

---

## 20. Reference Data — FIR Boundaries & Station Database {#20-reference-data}

### 20.1 Station/Aerodrome Database

The workstation needs a comprehensive database of aerodromes and their metadata:

| Field | Source | Use |
|---|---|---|
| ICAO 4-letter code | ICAO Doc 7910 (Location Indicators) | All OPMET queries and sorting |
| Latitude/Longitude | ICAO Doc 7910 or national AIPs | Map plotting |
| Aerodrome name | ICAO Doc 7910 | Display labels |
| Country/State | ICAO Doc 7910 | Sort by country (Criterion 4a, 5a) |
| FIR designator | National AIPs / eANP | Sort by FIR (Criterion 4a, 5a) |
| ICAO region | ICAO regional mapping | Filter by region |

**Sources:**
- ICAO Doc 7910 — Location Indicators (updated periodically)
- OurAirports (open data): https://ourairports.com/data/
- OpenFlights airport database
- National Aeronautical Information Publications (AIPs)

### 20.2 FIR Boundary Database

Required for geographic plotting of SIGMETs and for sorting OPMET by FIR.

| Field | Use |
|---|---|
| FIR designator (e.g., EGTT) | SIGMET parsing, sorting |
| FIR name (e.g., LONDON) | Display |
| Boundary polygon | Geographic rendering of SIGMETs, determining which FIR a station belongs to |
| Responsible State | Country sorting |

**Sources:**
- EUROCONTROL EAD (European AIS Database)
- FAA NASR (National Airspace System Resources)
- Various open-source FIR boundary datasets (GeoJSON/Shapefile format)
- ICAO eANP (electronic Air Navigation Plans)

### 20.3 ICAO Code → Region Mapping

For OPMET regional filtering. ICAO location indicator prefixes map to regions:

| First Letter(s) | Region | Notes |
|---|---|---|
| A | South Pacific (ASIAPAC) | Also Western Pacific |
| B | Iceland/Greenland/Kosovo (EUR/NAT) | |
| C | Canada (NAM) | |
| D | West Africa (AFI) | Also parts of N. Africa |
| E | Northern Europe (EUR/NAT) | |
| F | Southern Africa / Indian Ocean (AFI) | |
| G | West/Central Africa (AFI) | **Includes Canary Islands (Spain)** |
| H | East/Northeast Africa (AFI) | |
| K | Continental USA (NAM) | |
| L | Southern Europe / Israel (EUR/NAT) | **Includes Madeira (Portugal)** |
| M | Central America / Mexico (CARSAM) | |
| N | Misc Pacific (ASIAPAC) | New Zealand, Pacific islands |
| O | Middle East / South Asia (MID) | Afghanistan, Pakistan, Iran, Gulf states |
| P | Eastern Pacific / Alaska (ASIAPAC/NAM) | |
| R | East Asia (ASIAPAC) | Japan, Korea, Philippines |
| S | South America (CARSAM) | |
| T | Caribbean (CARSAM) | |
| U | Russia / CIS (EUR/NAT / ASIAPAC) | Spans multiple regions |
| V | South/Southeast Asia (ASIAPAC) | India, Thailand, etc. |
| W | Southeast Asia (ASIAPAC) | Indonesia, Malaysia |
| Y | Australia (ASIAPAC) | |
| Z | China / Mongolia (ASIAPAC) | |

**Critical note from WIFS documentation:** Some airports may appear in unexpected regional collections due to their ICAO code prefix. For example, Canary Islands (Spain) have codes starting with "G" and appear in the AFI collection, not EUR-NAT. Madeira (Portugal) has codes starting with "L" and appears in EUR-NAT. The workstation must handle these edge cases correctly.

---

**END OF IMPLEMENTATION REFERENCE GUIDE v1.1**

*This document should be used in conjunction with the Technical Specification (WAFS-WS-SPEC-2026-001) and the Evaluation Compliance Matrix (WAFS-WS-ECM-2026-001). For questions regarding SADIS access, contact the SADIS Manager at SADISmanager@metoffice.gov.uk. For WIFS support, contact the AWC help desk via aviationweather.gov.*
