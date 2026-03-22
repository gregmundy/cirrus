# WAFS Workstation — SADIS API Evaluation Compliance Matrix

**Document ID:** WAFS-WS-ECM-2026-001  
**Companion to:** WAFS-WS-SPEC-2026-001 (Technical Specification) and WAFS-WS-IRG-2026-001 (Implementation Reference Guide)  
**Version:** 1.0 — March 2026  
**Source Evaluation Criteria:** SADIS API Workstation Software Evaluation Criteria, endorsed WG-MOG/25 (SADIS), 6-7 June 2024  

---

## Purpose

This document maps every requirement in the SADIS API Workstation Software Evaluation Criteria to specific sections of the Technical Specification (SPEC) and Implementation Reference Guide (IRG). It serves as a compliance checklist for development teams and as a pre-evaluation readiness assessment tool.

**The evaluation is pass/fail per criterion.** All sub-requirements within a criterion must be satisfied for a COMPLIANT result. A single sub-requirement failure results in NON-COMPLIANT for that entire criterion.

---

## Evaluation Overview

| # | Criterion | Description |
|---|---|---|
| 1 | Connection & Download | Connect to SADIS API; download at correct intervals |
| 2 | GRIB2 Decoder & Display | Decode and display all gridded WAFS parameters |
| 3 | SIGWX IWXXM Decoder & Display | Decode and display SIGWX from IWXXM data |
| 4 | OPMET TAC List/Report | Display OPMET in list form from TAC data |
| 5 | OPMET IWXXM Human-Readable | Display OPMET in human-readable form from IWXXM |
| 6 | OPMET TAC Map Display | Plot OPMET on map from TAC data |
| 7 | OPMET IWXXM Map Display | Plot OPMET on map from IWXXM data |
| 8 | Advisory Graphics | Display VAA and TCA graphic charts |
| 9 | Advisory Alerting | Alert operators when advisories are received |

---

## Criterion 1: Connection and Download of Data from the SADIS API

### Sub-Requirements

| ID | Requirement | SPEC Section | IRG Section | Implementation Notes |
|---|---|---|---|---|
| 1a | Download OPMET data at 5-minute intervals | §3.2.1 | §2.8 | OPMET polling loop on 5-min timer. Must demonstrate continuous automatic polling, not manual/on-demand. |
| 1b | Download WAFS gridded data within 1 hour of publication | §3.2.1 | §2.7, §2.8 | Data published ~4.5 hrs after synoptic run. System must detect and download within 60 min of availability. |
| 1c | Download WAFS SIGWX data within 1 hour of publication | §3.2.1 | §2.7, §2.8 | Same timing discipline as gridded data. All 15 SIGWX timesteps (T+6 to T+48). |

### Demonstration Approach
Show the system monitor / acquisition log displaying timestamps of data downloads against API publication times. The evaluator will verify the cadence over a multi-hour observation window.

---

## Criterion 2: WAFS GRIB2 Decoder and Compliant Display Package

### Sub-Criterion 2a: Wind/Temperature Charts (ICAO Style)

| ID | Requirement | SPEC Section | IRG Section | Implementation Notes |
|---|---|---|---|---|
| 2a.1 | Conform to ICAO Annex 3 / PANS-MET display standards | §5.1.2 | §7.2, §8.1 | Wind barbs, temp contours per ICAO conventions. |
| 2a.2 | Cover a range of flight levels and timesteps | §4.1 | §3.3, §3.7 | Must show data at multiple FLs (e.g., FL100, FL300, FL450) and multiple forecast hours. |
| 2a.3 | Use both 0.25° and 1.25° data | §4.1.1, §4.1.2 | §3.3 | Demonstrate display from both resolutions. Evaluator may request specific resolution. |
| 2a.4 | Show data anywhere including across IDL, poles, both hemispheres | §5.1.1 | §9.2 | Demonstrate Pacific (IDL crossing), Arctic (N pole), Antarctic (S pole), and Southern Hemisphere displays. |
| 2a.5 | Pan, zoom, and change map projection | §5.1.1 | §9.1 | Smooth interaction. At minimum: Mercator, Polar Stereo N/S. |
| 2a.6 | Display as fixed ICAO chart areas (A–M) | §5.1.1 | §18.2, §18.3 | Named preset views. Must cover all 13 areas: A, B, B1, C, D, E, F, G, H, I, J, K, M. |
| 2a.7 | Legends with WAFC source, validity time, flight level | §5.1.2 (legend), §7.2.1 | §7.2.1 | Legend must identify EGRR or KWBC, exact valid time in UTC, and FL. |

### Sub-Criterion 2b: All Gridded Parameters

| ID | Requirement | SPEC Section | IRG Section | Implementation Notes |
|---|---|---|---|---|
| 2b.1 | Wind display | §5.2.1 | §3.8, §8.1 | Wind barbs or arrows with speed/direction. |
| 2b.2 | Temperature display | §5.2.1 | §8.2 | Contour plots with clear labeling. |
| 2b.3 | Relative humidity display | §4.1 | §3.3 | 5 levels (1.25°) or 14 levels (0.25°). |
| 2b.4 | Geopotential height display | §4.1 | §3.3, §8.2 | Contour lines at standard intervals. |
| 2b.5 | Tropopause height/temp display | §5.1.2 (tropopause) | §7.2.6, §3.3 | Thin contour lines labeled with FL. |
| 2b.6 | Max wind (jet stream) display | §4.1 | §3.3 | Position, speed, height of maximum wind. |
| 2b.7 | Range of FLs and timesteps | §4.1 | §3.3, §3.7 | Multiple demonstrations at evaluator's request. |
| 2b.8 | Global coverage including IDL | §5.1.1 | §9.2 | Same as 2a.4. |
| 2b.9 | Pan, zoom, projection change | §5.1.1 | §9.1 | Same as 2a.5. |
| 2b.10 | Clear colour schemes | §5.2 | §7.5, §8.2 | Unambiguous, graduated colour scales. |
| 2b.11 | Legends with WAFC, time, FL | §5.1.2 | §7.2.1 | Same as 2a.7. |

### Sub-Criterion 2c: Hazard Data (CB, Turbulence, Icing)

| ID | Requirement | SPEC Section | IRG Section | Implementation Notes |
|---|---|---|---|---|
| 2c.1 | Cumulonimbus display (extent, base, top) | §5.2.2 | §3.3 | Filled contour or shaded overlay. |
| 2c.2 | Turbulence severity display | §5.2.2 | §3.3 | 36 levels (FL100–FL450). Graduated colour scale. |
| 2c.3 | Icing severity display | §5.2.2 | §3.3 | 26 levels (FL050–FL300). Graduated colour scale. |
| 2c.4 | Range of FLs and timesteps | §4.1.2 | §3.3 | Multiple demonstrations. |
| 2c.5 | Global coverage including IDL | §5.1.1 | §9.2 | Same as 2a.4. |
| 2c.6 | Pan, zoom, projection change | §5.1.1 | §9.1 | Same as 2a.5. |
| 2c.7 | Clear colour schemes | §5.2.2 | §7.5 | Distinct colours per hazard type. |
| 2c.8 | Legends with WAFC, time, FL | §5.1.2 | §7.2.1 | Same as 2a.7. |

---

## Criterion 3: WAFS IWXXM Format SIGWX Decoder and Compliant Display

### Sub-Criterion 3a: SIGWX Chart Display

| ID | Requirement | SPEC Section | IRG Section | Implementation Notes |
|---|---|---|---|---|
| 3a.1 | Pan, zoom, layer toggle, projection change | §5.1.1 | §9.1 | LAYER TOGGLE is a specific requirement — independent on/off for each SIGWX element (jets, turb, icing, CB, tropopause, etc.). |
| 3a.2 | Conform to ICAO Annex 3 / PANS-MET display conventions | §5.1.2 | §7.2 | All symbology: dashed lines for turb, scalloped for CB, etc. |
| 3a.3 | Text box/arrow placement unambiguous to users | §5.1.2 | §7.2.2–7.2.8 | Labels must not overlap, must clearly associate with features. |
| 3a.4 | Colour schemes unambiguous | §5.1.2 | §7.5 | Icing distinct from CB; turb distinct from both. |
| 3a.5 | **Meteorological content identical to WAFC cross-check PNG charts** | §5.1.2 | §7.2, §14.2 | **This is the hardest requirement.** Feature positions, extents, severities, FL ranges must exactly match the reference PNGs. |
| 3a.6 | Cover a range of forecast timesteps | §5.1.3 | §7.4 | T+6 through T+48, 3-hourly. All 15 timesteps. |
| 3a.7 | Global coverage including IDL, poles, both hemispheres | §5.1.1 | §9.2 | Must render correctly across antimeridian and at poles. |
| 3a.8 | Display as fixed ICAO chart areas (A–M) | §5.1.1 | §18.2, §18.3 | Same 13 area presets as 2a.6. |
| 3a.9 | Legends with WAFC issuer, validity, FL range | §5.1.2 | §7.2.1 | "ISSUED BY: WAFC London" / "PROVIDED BY: [Your Name]". |
| 3a.10 | **Auto-remove WAFC reference if user modifies data** | §5.1.2 | §7.2.1 | If ANY meteorological parameter is changed by operator, WAFC attribution is stripped. Chart becomes a "national product." |

### Sub-Criterion 3b: SIGWX Briefing Chart (Print)

| ID | Requirement | SPEC Section | IRG Section | Implementation Notes |
|---|---|---|---|---|
| 3b.1 | Clear and unambiguous printed output | §5.4 | §7.2 | Print at sufficient resolution. All symbology legible in print. |
| 3b.2 | Appropriately labelled | §5.4 | §7.2.1 | Legend, WAFC source, validity, FL range, area, notes visible on printout. |

---

## Criterion 4: OPMET TAC in List/Report Form

### Sub-Criterion 4a: Standard OPMET Products

| ID | Requirement | SPEC Section | IRG Section | Implementation Notes |
|---|---|---|---|---|
| 4a.1 | Retrieve and display TAFs | §5.3 | §6.4 | TAC text format. |
| 4a.2 | Retrieve and display METARs | §5.3 | §6.3 | TAC text format. |
| 4a.3 | Retrieve and display SPECIs | §5.3 | §6.3 | Same parser as METAR with SPECI header. |
| 4a.4 | Retrieve and display SIGMETs | §5.3 | §6.5 | TAC text format. |
| 4a.5 | Retrieve and display AIRMETs (EUR region) | §5.3 | §6.5 | EUR-only product. |
| 4a.6 | Retrieve and display GAMETs | §5.3 | §6 (general) | General aviation MET forecast. |
| 4a.7 | Retrieve and display Special AIREPs | §5.3 | §6 (general) | Pilot reports of significant weather. |
| 4a.8 | From all 5 regions: CARSAM, NAM, EUR/NAT, MID, ASIAPAC | §5.3 | §20.3 | Must demonstrate from EACH region. |
| 4a.9 | Displayed in plain text format | §5.3 | §6 | Raw TAC text, not decoded. |
| 4a.10 | Sortable by issuing country | §5.3 | §17.5, §20.1 | Requires ICAO code → country mapping. |
| 4a.11 | Sortable by FIR | §5.3 | §17.5, §20.2 | Requires ICAO code → FIR mapping. |
| 4a.12 | Requestable by individual airport (ICAO code) | §5.3 | §17.5 | Filter by specific 4-letter code. |
| 4a.13 | Requestable by individual FIR | §5.3 | §17.5, §20.2 | Filter by FIR designator. |

### Sub-Criterion 4b: Advisory Products

| ID | Requirement | SPEC Section | IRG Section | Implementation Notes |
|---|---|---|---|---|
| 4b.1 | Retrieve and display Tropical Cyclone Advisory (TAC) | §5.3 | §15.2 | TCA messages in plain text. |
| 4b.2 | Retrieve and display Volcanic Ash Advisory (TAC) | §5.3 | §15.2 | VAA messages in plain text. |
| 4b.3 | Retrieve and display Space Weather Advisory (TAC) | §5.3 | §15.4 | **Gap closed in IRG v1.1** — SWx advisory text. |
| 4b.4 | Retrieve and display radioactive release messages | §5.3 | §15.6 | **Gap closed in IRG v1.1** — nuclear emergency text. |
| 4b.5 | Retrieve and display NOTAM/ASHTAM relating to VA | §5.3 | §15.5 | **Gap closed in IRG v1.1** — ASHTAM display. |
| 4b.6 | From a range of regions | §5.3 | §20.3 | Multiple regions demonstrated. |
| 4b.7 | Plain text format | §5.3 | §15 | Raw TAC text display. |
| 4b.8 | Sortable by country/FIR | §5.3 | §17.5, §20.1 | Same sorting as 4a. |
| 4b.9 | Requestable by airport/FIR | §5.3 | §17.5 | Same filtering as 4a. |

---

## Criterion 5: OPMET IWXXM in Human-Readable Form

### Sub-Criterion 5a: Standard OPMET from IWXXM

| ID | Requirement | SPEC Section | IRG Section | Implementation Notes |
|---|---|---|---|---|
| 5a.1 | Display TAFs from IWXXM in human-readable form | §5.3 | §5.4, §17.2 | NOT raw XML. Rendered to structured readable format. |
| 5a.2 | Display METARs from IWXXM in human-readable form | §5.3 | §5.4, §17.3 | See IRG §17.3 for example rendering. |
| 5a.3 | Display SPECIs from IWXXM | §5.3 | §5.4, §17 | Same renderer as METAR. |
| 5a.4 | Display SIGMETs from IWXXM in human-readable form | §5.3 | §5.4, §17.4 | See IRG §17.4 for example rendering. |
| 5a.5 | Display AIRMETs from IWXXM | §5.3 | §5.4, §17 | EUR region. |
| 5a.6 | From all 5 regions | §5.3 | §20.3 | Where IWXXM data is available (note: coverage expanding). |
| 5a.7 | Sortable by country/FIR | §5.3 | §17.5, §20.1 | Same sorting as Criterion 4. |
| 5a.8 | Requestable by airport/FIR | §5.3 | §17.5 | Same filtering as Criterion 4. |

### Sub-Criterion 5b: Advisory Products from IWXXM

| ID | Requirement | SPEC Section | IRG Section | Implementation Notes |
|---|---|---|---|---|
| 5b.1 | Display TCA from IWXXM in human-readable form | §5.3 | §15.2, §17 | Render `iwxxm:TropicalCycloneAdvisory` to readable format. |
| 5b.2 | Display VAA from IWXXM in human-readable form | §5.3 | §15.2, §17 | Render `iwxxm:VolcanicAshAdvisory` to readable format. |
| 5b.3 | Display SWx from IWXXM in human-readable form | §5.3 | §15.4, §17 | Render `iwxxm:SpaceWeatherAdvisory` to readable format. |
| 5b.4 | From a range of regions | §5.3 | §20.3 | Where IWXXM data is available. |
| 5b.5 | Sortable and requestable | §5.3 | §17.5 | Same as Criterion 5a. |

---

## Criterion 6: OPMET TAC on Map Display

### Sub-Criterion 6a: METAR/SPECI/TAF on Map

| ID | Requirement | SPEC Section | IRG Section | Implementation Notes |
|---|---|---|---|---|
| 6a.1 | Display METAR/SPECI/TAF on map | §5.3 | §19.2 | Stations plotted at correct lat/lon positions. |
| 6a.2 | Key elements visible | §5.3 | §19.2 | Flight category, wind, visibility, significant weather. |
| 6a.3 | Colour coding relating to forecast elements | §5.3 | §19.2 | VFR=Green, MVFR=Blue, IFR=Red, LIFR=Magenta. |
| 6a.4 | **Automatic update when new data received** | §5.3 | §19.2 | **Must refresh without operator action.** Evaluator will watch for auto-update across polling cycles. |

### Sub-Criterion 6b: SIGMET and Special AIREP on Map

| ID | Requirement | SPEC Section | IRG Section | Implementation Notes |
|---|---|---|---|---|
| 6b.1 | Display SIGMET areas on map | §5.3 | §19.3 | Shaded polygons at correct geographic position. |
| 6b.2 | Display Special AIREPs on map | §5.3 | §19.3 | **Point symbols at reported position with phenomenon.** |
| 6b.3 | Key elements visible | §5.3 | §19.3 | Phenomenon type, severity, FL range. |
| 6b.4 | Correct geographic location | §5.3 | §19.3 | Polygon vertices or point positions match message content. |
| 6b.5 | Colour coding by element | §5.3 | §19.3 | Distinct colours per phenomenon. |

---

## Criterion 7: OPMET IWXXM on Map Display

### Sub-Criterion 7a: METAR/SPECI/TAF from IWXXM on Map

| ID | Requirement | SPEC Section | IRG Section | Implementation Notes |
|---|---|---|---|---|
| 7a.1 | Same functional display as 6a but from IWXXM source | §5.3 | §19.4 | Demonstrates that IWXXM parsing feeds the same map renderer. |
| 7a.2 | Key elements, colour coding, auto-update | §5.3 | §19.2, §19.4 | Identical behaviour to 6a. |

### Sub-Criterion 7b: SIGMET from IWXXM on Map

| ID | Requirement | SPEC Section | IRG Section | Implementation Notes |
|---|---|---|---|---|
| 7b.1 | Same functional display as 6b but from IWXXM source | §5.3 | §19.4 | IWXXM-decoded SIGMETs rendered identically to TAC-decoded. |
| 7b.2 | Key elements, correct location, colour coding | §5.3 | §19.3, §19.4 | Identical behaviour to 6b. |

**Note on Criteria 7a/7b:** The evaluation acknowledges that full global IWXXM coverage is not yet available. Only data from regions that are internationally exchanging IWXXM needs to be shown.

---

## Criterion 8: Display of Volcanic Ash and Tropical Cyclone Advisory Graphics

| ID | Requirement | SPEC Section | IRG Section | Implementation Notes |
|---|---|---|---|---|
| 8a.1 | Display VAA graphic charts (PNG) | §5.3 | §15.3 | PNG images from VAACs. Must be viewable, zoomable. |
| 8a.2 | Display TCA graphic charts (PNG) | §5.3 | §15.3 | PNG images from TCACs. Same display capability. |

### Demonstration Approach
Show any available VAA or TCA PNG graphic from the SADIS API. Display at full resolution with ability to pan/zoom. If no current VAA/TCA graphics are available at evaluation time, historical examples may be used.

---

## Criterion 9: Alerting When Advisory Products Are Received

### Sub-Criterion 9a: Alerting for TAC Advisories

| ID | Requirement | SPEC Section | IRG Section | Implementation Notes |
|---|---|---|---|---|
| 9a.1 | Alert on Volcanic Ash Advisory (TAC) | — | §16.2, §16.3 | **New requirement — fully specified in IRG v1.1 §16.** |
| 9a.2 | Alert on Tropical Cyclone Advisory (TAC) | — | §16.2, §16.3 | Same alerting mechanism. |
| 9a.3 | Alert on Space Weather Advisory (TAC) | — | §16.2, §16.3 | Same alerting mechanism. |
| 9a.4 | Alert on ASHTAM/NOTAM relating to VA (TAC) | — | §16.2, §16.3 | Same alerting mechanism. |
| 9a.5 | Alert on Nuclear Emergency Advisory (TAC) | — | §16.2, §16.3 | CRITICAL priority. |

### Sub-Criterion 9b: Alerting for IWXXM Advisories

| ID | Requirement | SPEC Section | IRG Section | Implementation Notes |
|---|---|---|---|---|
| 9b.1 | Alert on Volcanic Ash Advisory (IWXXM) | — | §16.2, §16.3 | Detect new `iwxxm:VolcanicAshAdvisory` in data stream. |
| 9b.2 | Alert on Tropical Cyclone Advisory (IWXXM) | — | §16.2, §16.3 | Detect new `iwxxm:TropicalCycloneAdvisory`. |
| 9b.3 | Alert on Space Weather Advisory (IWXXM) | — | §16.2, §16.3 | Detect new `iwxxm:SpaceWeatherAdvisory`. |

**Note:** The evaluation acknowledges that some advisory types may have no available test bulletins. Self-certification with demonstrated code paths is acceptable.

---

## Pre-Evaluation Readiness Checklist

Before requesting a SADIS API Workstation Software Evaluation, verify:

- [ ] Valid SADIS API credentials (APIM Developer Portal access)
- [ ] Valid WIFS API credentials (backup demonstration)
- [ ] System has been running continuously for ≥72 hours with data acquisition logs
- [ ] All 13 ICAO fixed chart areas (A through M) are configured as presets
- [ ] SIGWX display has been validated against WAFC cross-check PNG charts for ≥3 model runs
- [ ] OPMET data from all 5 regions (CARSAM, NAM, EUR/NAT, MID, ASIAPAC) is available
- [ ] IWXXM parsing covers all product types where IWXXM data is internationally exchanged
- [ ] Alert system has been tested with historical VAA and TCA messages
- [ ] Print output of SIGWX briefing chart is available for review
- [ ] Evaluation can be conducted in English (all UI labels, documentation, verbal explanation)
- [ ] Screenshots and logs prepared for criteria that cannot be demonstrated in real-time

### Evaluation Logistics
- Typical evaluation: 2 days of SADIS Manager's time
- Can be conducted via web-conferencing/screen sharing OR on-site
- Charges apply (rate advised before commitment)
- Must be conducted in English
- Final compliance decision rests solely with SADIS Manager, no appeal

---

**END OF EVALUATION COMPLIANCE MATRIX**
