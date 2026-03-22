# WAFS Workstation Technical Specification — Addendum A

**Document ID:** WAFS-WS-SPEC-2026-001-A  
**Amends:** WAFS-WS-SPEC-2026-001 v1.0 (Technical Specification)  
**Version:** 1.0 — March 2026  
**Purpose:** Incorporate requirements identified through detailed cross-reference against the SADIS API Workstation Software Evaluation Criteria (WG-MOG/25, June 2024). All items in this addendum have the same normative force as the base specification.

---

## Amendment 1: Section 4.3 — Additional OPMET Product Types

**Add the following to Section 4.3 (OPMET Data) of the base specification:**

The workstation shall additionally ingest, store, and display the following product types that are tested during the SADIS API evaluation:

- **Space Weather Advisories (SWx)** — Text advisories addressing impacts on HF communications, GNSS-based navigation, and radiation exposure at flight altitudes. Available in both TAC and IWXXM (`iwxxm:SpaceWeatherAdvisory`) formats. Issued by designated Space Weather centres.
- **ASHTAM** — NOTAM-format messages specifically related to volcanic ash contamination at or near aerodromes. Distributed as part of the OPMET data stream.
- **NOTAM relating to volcanic ash** — Standard NOTAM format messages concerning volcanic ash impact on airspace or aerodromes.
- **Nuclear emergency / radioactive release advisories** — Text messages concerning the release of radioactive material into the atmosphere, relevant to aviation routing decisions.
- **Special Air Reports (Special AIREPs)** — Pilot reports of significant en-route weather phenomena including turbulence, icing, wind shear, thunderstorms, volcanic ash, and other hazards. Reports contain aircraft position, flight level, time, and observed phenomenon.

---

## Amendment 2: New Section 5.5 — Advisory Product Graphics Display

**Insert as new Section 5.5 in the base specification:**

### 5.5 Advisory Product Graphics Display

The workstation shall retrieve and display graphic (PNG format) advisory charts produced by specialised advisory centres:

- **Volcanic Ash Advisory graphics** — PNG charts produced by the 9 Volcanic Ash Advisory Centres (VAACs): London, Toulouse, Montreal, Washington, Buenos Aires, Darwin, Tokyo, Wellington, Anchorage. These charts depict observed and forecast volcanic ash cloud positions and flight level extents.
- **Tropical Cyclone Advisory graphics** — PNG charts produced by Tropical Cyclone Advisory Centres (TCACs) depicting cyclone position, forecast track, and wind radii.

Requirements:
- Graphics shall be displayed at full resolution with pan and zoom capability
- Graphics shall be viewable in a dedicated advisory panel or overlaid on the main map display
- Graphics shall be timestamped and labeled with the issuing centre
- The system shall check for new advisory graphics at the same polling interval as OPMET data (every 5 minutes)

---

## Amendment 3: New Section 5.6 — Operator Alerting Subsystem

**Insert as new Section 5.6 in the base specification:**

### 5.6 Operator Alerting Subsystem

The workstation shall implement an active alerting subsystem that notifies operators when advisory-type forecasts are received. This is a mandatory evaluation requirement.

#### 5.6.1 Alert Triggers

The system shall generate an alert for each of the following newly received product types, in both TAC and IWXXM formats where applicable:

| Product | TAC Alert Required | IWXXM Alert Required | Priority |
|---|---|---|---|
| Volcanic Ash Advisory | Yes | Yes | HIGH |
| Tropical Cyclone Advisory | Yes | Yes | HIGH |
| Space Weather Advisory | Yes | Yes | HIGH |
| ASHTAM / VA NOTAM | Yes | N/A | HIGH |
| Nuclear Emergency Advisory | Yes | N/A | CRITICAL |

#### 5.6.2 Alert Mechanism

- Alerts shall include a visual notification (banner, popup, or indicator) on all active operator displays
- Alerts shall include a configurable audible notification
- CRITICAL-priority alerts shall require explicit operator acknowledgement before dismissal
- HIGH-priority alerts shall persist until acknowledged or superseded
- The system shall maintain an alert history log accessible to operators
- Alert settings (FIR filtering, product type filtering, sound configuration) shall be configurable by the system administrator
- CRITICAL-level alerts (nuclear emergency) shall not be disableable

#### 5.6.3 Detection Logic

The alerting system shall compare newly received messages against previously processed message identifiers to detect genuinely new advisories. Re-downloads or duplicates shall not trigger alerts.

---

## Amendment 4: Section 5.3 — OPMET Display Enhancements

**Amend Section 5.3 of the base specification with the following additional requirements:**

#### 5.3.1 TAC OPMET List/Report Display (Amended)

Add the following sorting and filtering capabilities:
- **Sort by issuing country** — using ICAO location indicator to country mapping
- **Sort by Flight Information Region (FIR)** — using ICAO code to FIR designator mapping
- **Request by individual airport** — filter by specific ICAO 4-letter code
- **Request by individual FIR** — filter by FIR designator
- The system shall demonstrate retrieval from all five ICAO regions: CARSAM, NAM, EUR/NAT, MID, ASIAPAC

#### 5.3.2 IWXXM OPMET Human-Readable Display (New)

IWXXM-formatted OPMET products shall be rendered in a **human-readable form** — not as raw XML. The rendering shall:
- Transform XML element values into structured, plain-language display
- Use ICAO-standard meteorological terminology and abbreviations
- Present decoded values with proper units (knots, hectopascals, degrees Celsius, etc.)
- Apply the same sorting, filtering, and request capabilities as TAC list/report display (Section 5.3.1)
- Be functionally equivalent to the TAC display in terms of information content

#### 5.3.3 OPMET Geographic Map Display (Amended)

Add the following requirements to the existing OPMET map display specification:

**METAR/SPECI/TAF on map:**
- Apply flight category colour coding: VFR (green), MVFR (blue), IFR (red), LIFR (magenta)
- **Automatic refresh:** The map display shall update automatically when new OPMET data is received, without operator intervention. The polling interval for OPMET is 5 minutes per Criterion 1a.
- Both TAC-sourced and IWXXM-sourced data shall produce functionally equivalent map displays

**SIGMET on map:**
- Display SIGMET areas as shaded polygons at the correct geographic positions
- Apply colour coding by phenomenon type (turbulence, icing, volcanic ash, thunderstorms)
- Show key elements: phenomenon type, severity, flight level range, movement

**Special AIREPs on map:**
- Display Special Air Reports as point symbols at the reported aircraft position
- Indicate the observed phenomenon (turbulence, icing, etc.) and severity
- Both TAC-sourced and IWXXM-sourced data shall produce functionally equivalent displays

---

## Amendment 5: Section 5.1.1 — ICAO Fixed Chart Areas

**Amend Section 5.1.1 of the base specification to add:**

The workstation shall include named preset views for all 13 ICAO fixed SIGWX chart areas as defined in ICAO Annex 3, Appendix 8, Figures A8-1 through A8-3:

Areas: A, B, B1, C, D, E, F, G, H, I, J, K, M

The operator shall be able to select any ICAO chart area from a menu or toolbar control, causing the map display to snap to the predefined geographic extent and appropriate map projection (Mercator for equatorial areas, Polar Stereographic for polar areas J, K, M). When displayed as a fixed ICAO area, the legend shall identify the area code.

---

## Amendment 6: Section 3.2.1 — Data Acquisition Polling Intervals

**Amend Section 3.2.1 of the base specification to explicitly specify:**

| Data Type | Polling Interval | Evaluation Criterion |
|---|---|---|
| OPMET data (METAR, TAF, SIGMET, advisories) | Every 5 minutes | Criterion 1a |
| WAFS gridded data (GRIB2) | Within 1 hour of API publication | Criterion 1b |
| WAFS SIGWX data (IWXXM) | Within 1 hour of API publication | Criterion 1c |
| Advisory graphics (VAA/TCA PNG) | Every 5 minutes (with OPMET) | Criterion 8 |

---

## Amendment 7: Section 10 — Reference Data Requirements

**Add to Section 10 or create new Section 10.4 in the base specification:**

### 10.4 Reference Data

The workstation shall maintain the following reference datasets:

- **Aerodrome database:** ICAO 4-letter codes, coordinates, names, countries, and FIR assignments for all ICAO-listed aerodromes (source: ICAO Doc 7910)
- **FIR boundary database:** Geographic boundaries of all Flight Information Regions as GIS-compatible polygons (source: eANP, EUROCONTROL, national AIPs)
- **ICAO code to region mapping:** First-letter prefix mapping for OPMET regional filtering (with documented edge cases such as Canary Islands in AFI, Madeira in EUR-NAT)
- **ICAO fixed chart area definitions:** Geographic extents and projection parameters for all 13 SIGWX chart areas (A through M)

Reference data shall be updateable without software redeployment.

---

## Amendment Summary

| # | Amendment | Evaluation Criteria Addressed |
|---|---|---|
| 1 | Additional OPMET products (SWx, ASHTAM, nuclear, Special AIREP) | 4b, 6b |
| 2 | Advisory graphics display (VAA/TCA PNG) | 8 |
| 3 | Operator alerting subsystem | 9a, 9b |
| 4 | OPMET display enhancements (sorting, IWXXM human-readable, auto-refresh, Special AIREP map) | 4a, 5a, 5b, 6a, 6b, 7a, 7b |
| 5 | ICAO fixed chart areas (A–M presets) | 2a, 3a |
| 6 | Data acquisition polling intervals | 1a, 1b, 1c |
| 7 | Reference data requirements | 4a, 5a (sorting by country/FIR) |

With these amendments, the combined specification (base + Addendum A) addresses all 9 evaluation criteria and all sub-requirements within them.

---

**END OF ADDENDUM A**
