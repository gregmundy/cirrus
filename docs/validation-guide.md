# Cirrus WAFS Workstation — Validation Guide

How to cross-reference Cirrus output against authoritative WAFS sources for each evaluation criterion.

---

## Reference Chart Sources

### WAFC Washington (KKCI) — NOAA Aviation Weather Center

| Resource | URL | Use For |
|----------|-----|---------|
| **SIGWX Charts** | https://aviationweather.gov/sigwx/ | Criterion 3 — reference PNGs for SIGWX rendering validation |
| **Prognostic Charts** | https://aviationweather-cprk.ncep.noaa.gov/progchart/help | Criterion 2 — wind/temp/jet stream chart comparison |
| **WAFS Data Viewer** | https://aviationweather-cprk.ncep.noaa.gov/wafs/help | Criterion 2 — gridded data visualization reference |

### WAFC London (EGRR) — Met Office

| Resource | URL | Use For |
|----------|-----|---------|
| **WAFC Homepage** | https://www.metoffice.gov.uk/services/transport/aviation/regulated/international-aviation/wafc/index | SIGWX + gridded chart references |
| **Estonia Mirror** | https://www.lennuilm.ee/prognoosiinfo/wafc/?lang=en | Alternative access to WAFC London charts |
| **Iceland Mirror** | https://en.vedur.is/weather/aviation/wafc/ | Alternative access to WAFC London charts |

Both WAFCs publish reference charts every 6 hours (0000, 0600, 1200, 1800 UTC).

---

## Sample WAFS Data

### WIFS API (WAFS Internet File Service)

No SADIS credentials needed for browsing the API structure and downloading sample data.

| Resource | URL |
|----------|-----|
| **Interactive Query Builder** | https://aviationweather.gov/wifs/api/query_builder?f=html |
| **OpenAPI Specification** | https://aviationweather.gov/wifs/api/openapi?f=html |
| **User Guide (v9.0)** | https://aviationweather.gov/wifs/users_guide/ |
| **Base API URL** | `https://aviationweather.gov/wifs/api` |

Key WIFS collections:
- `egrr_wafs_windtempgeo_0p25` — 0.25° wind, temp, geopotential height (WAFC London)
- `kkci_wafs_windtempgeo_0p25` — same from WAFC Washington

### SADIS API

For full WAFS data access (required for evaluation):
- **User Guide:** https://www.icao.int/sites/default/files/METP/Documents/SADIS-API-User-Guide-1st-Edition.pdf
- **Contact for credentials:** SADISmanager@metoffice.gov.uk
- **SADIS User Guide 6th Ed:** https://www.metoffice.gov.uk/binaries/content/assets/metofficegovuk/pdf/services/transport/aviation/sadis/sug_6th-edition-part1-v2.6-01.05.2024.pdf

---

## Rendering Specifications

| Document | URL | Use For |
|----------|-----|---------|
| **SIGWX Interpretation Guide v2.01** | https://www.metoffice.gov.uk/binaries/content/assets/metofficegovuk/pdf/services/transport/aviation/wafs/sigwx-interpretation-guide-v2.01.pdf | Definitive symbology reference — scalloped CB, jet barbs, turbulence dashing, icing patterns |
| **SIGWX BUFR Visualisation Guide** | https://aviationweather.gov/progchart/help?page=high | Technical rendering specifications |
| **IWXXM Schema Repository** | https://schemas.wmo.int/iwxxm/ | XML schema for SIGWX, METAR, TAF, SIGMET IWXXM formats |
| **IWXXM GitHub** | https://github.com/wmo-im/iwxxm | Schema source, examples, changelog |

---

## Validation Procedures by Criterion

### Criterion 1: Data Acquisition
- **Method:** Verify download timestamps against WAFS publication schedule
- **Reference:** SADIS/WIFS API metadata includes publication timestamps
- **Pass condition:** Data downloaded within 60 minutes of publication for each product type

### Criterion 2: GRIB2 Decoder and Display

**2a-2b: Wind, Temperature, Height, RH, Tropopause, Max Wind**
1. Load a specific GFS run and forecast hour in Cirrus
2. Open the AWC Prognostic Charts page for the same run/hour
3. Compare: wind barb placement, isotherms, height contours, tropopause FL values, jet stream cores
4. Verify each ICAO area preset (A-M) snaps to correct geographic extent
5. Check legend shows correct WAFC source, validity time, and FL

**2c: Hazard Data (CB, Turbulence, Icing)**
1. Requires 0.25° WAFS-specific GRIB2 data (not GFS)
2. Compare against AWC WAFS data viewer for severity thresholds and spatial extent

### Criterion 3: SIGWX IWXXM Display

**This is the highest-risk criterion.** The evaluator will compare your rendered SIGWX chart against the WAFC reference PNG for the exact same validity time.

1. Download the IWXXM SIGWX data for a specific validity time from SADIS/WIFS
2. Render it in Cirrus
3. Download the corresponding WAFC reference PNG from https://aviationweather.gov/sigwx/
4. **Overlay comparison:** feature positions, polygon boundaries, jet stream axes, FL ranges, and severities must match
5. Check: scalloped CB boundaries, turbulence dashing patterns, jet barb placement, text label positions
6. Verify across multiple ICAO areas and timesteps

**Common failure modes (from evaluator summary):**
- Polygon misalignment (GML coordinate order errors — lat/lon vs lon/lat)
- Missing or incorrect scalloped CB boundary rendering
- Jet stream barb spacing or direction errors
- Label overlap or placement outside the feature area
- FL range annotations missing or truncated

### Criteria 4-5: OPMET Text Display
- **Reference:** Compare parsed TAC/IWXXM output against raw source text
- **Verify:** All product types (METAR, TAF, SPECI, SIGMET, AIRMET, AIREP) from all 5 regions
- **Check:** Sorting by country/FIR, filtering by airport/FIR code

### Criteria 6-7: OPMET on Map
- **Reference:** Compare station plots against AWC METARs display
- **Verify:** Flight category coloring, wind barb direction, cloud cover encoding, auto-refresh
- **Check:** SIGMET polygon placement matches official SIGMET coordinates

### Criterion 8: Advisory Graphics
- **Reference:** WAFC VAA/TCA PNG products
- **Verify:** Images display correctly with pan/zoom capability

### Criterion 9: Alerting
- **Method:** Inject test advisory products and verify alert triggers
- **Verify:** Alerts appear for VAA, TCA, SWx, ASHTAM, nuclear emergency
- **Check:** Both TAC and IWXXM advisory formats trigger alerts

---

## Quick Validation Checklist

For any visual layer, verify:

- [ ] Feature positions match reference chart
- [ ] Colors are distinct and unambiguous
- [ ] Labels are readable and correctly placed
- [ ] Legend shows: data source (EGRR/KKCI), validity time (UTC), flight level
- [ ] ICAO area presets snap to correct geographic extent
- [ ] Pan/zoom works without rendering artifacts
- [ ] IDL (International Date Line) crossing renders correctly
- [ ] Both hemispheres display correctly
- [ ] Layer toggles work independently
