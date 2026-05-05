import { PathLayer, TextLayer, IconLayer, SolidPolygonLayer } from '@deck.gl/layers';
import { PathStyleExtension } from '@deck.gl/extensions';
import type { Layer } from '@deck.gl/core';
import { interpolateSpline, generateScallopedRing } from '../../utils/splineInterpolation';
import { getWindBarbKey } from '../../utils/windBarbs';
import type { SigwxSymbolAtlas } from '../../utils/sigwxSymbols';

export interface SigwxGeoJSON {
  type: 'Feature';
  geometry: {
    type: 'Point' | 'LineString' | 'Polygon';
    // GeoJSON coordinates are polymorphic by geometry.type; consumers narrow at use site.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    coordinates: any;
  };
  // SIGWX feature properties vary by phenomenon (cloud, jet, turbulence, icing, …).
  // A discriminated union per phenomenon would be cleaner but is out of scope for a lint pass.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  properties: Record<string, any>;
}

// Outline colors per phenomenon (matching ICAO chart style)
const OUTLINE_COLORS: Record<string, [number, number, number, number]> = {
  JETSTREAM: [30, 30, 30, 255],         // Black thick line
  TURBULENCE: [60, 60, 60, 220],        // Dark grey dashed
  AIRFRAME_ICING: [140, 50, 180, 220],  // Purple per ICAO
  CLOUD: [200, 30, 30, 220],            // Red scalloped
  TROPOPAUSE: [70, 140, 210, 200],      // Blue dotted
};

// Label text colors
const LABEL_COLORS: Record<string, [number, number, number, number]> = {
  JETSTREAM: [20, 100, 50, 255],
  TURBULENCE: [40, 40, 40, 255],
  AIRFRAME_ICING: [120, 40, 160, 255],
  CLOUD: [180, 20, 20, 255],
  TROPOPAUSE: [50, 120, 190, 255],
};

// WMO severity codes
const TURBULENCE_LABEL: Record<string, string> = {
  '4': 'LGT', '6': 'LGT-MOD', '8': 'MOD', '10': 'SEV', '12': 'EXTR',
};
const TURBULENCE_IS_SEVERE: Record<string, boolean> = { '10': true, '12': true };
const ICING_LABEL: Record<string, string> = {
  '1': 'LGT', '2': 'LGT', '3': 'MOD', '4': 'SEV',
};
const ICING_IS_SEVERE: Record<string, boolean> = { '4': true };
const CLOUD_DIST: Record<string, string> = { '10': 'ISOL', '11': 'OCNL', '12': 'FRQ' };

/** Smooth a polygon ring using cubic spline interpolation. */
function smoothRing(ring: [number, number][]): [number, number][] {
  if (ring.length < 4) return ring;
  const open = ring.slice(0, -1);
  const looped = [...open, open[0], open[1]];
  const smooth = interpolateSpline(looped, 8);
  const trimmed = smooth.slice(0, smooth.length - 16);
  if (trimmed.length > 0) trimmed.push(trimmed[0]);
  return trimmed;
}

function centroid(ring: [number, number][]): [number, number] {
  return [
    ring.reduce((s, p) => s + p[0], 0) / ring.length,
    ring.reduce((s, p) => s + p[1], 0) / ring.length,
  ];
}

function bearing(p1: [number, number], p2: [number, number]): number {
  return (Math.atan2(p2[0] - p1[0], p2[1] - p1[1]) * 180) / Math.PI;
}

/** Zoom-responsive scale factor. */
function sigwxScale(zoom: number): number {
  return 1.0 + Math.max(0, zoom - 3) * 0.2;
}

/** Format FL range as ICAO call-out: "XXX/320" or "340/400". */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see SigwxGeoJSON.properties note
function flRange(props: Record<string, any>): string {
  const lower = props.lower_fl != null ? `${props.lower_fl}` : 'XXX';
  const upper = props.upper_fl != null ? `${props.upper_fl}` : 'XXX';
  return `${lower}/${upper}`;
}

// ─── SHARED LABEL STYLE (ICAO call-out box: white bg, dark border) ───

const CALLOUT_BG: [number, number, number, number] = [255, 255, 255, 240];
const CALLOUT_PADDING: [number, number] = [6, 3];

export function createSigwxLayers(
  features: SigwxGeoJSON[],
  sigwxAtlas?: SigwxSymbolAtlas | null,
  jetBarbAtlas?: string | null,
  jetBarbMapping?: Record<string, { x: number; y: number; width: number; height: number }> | null,
  mapZoom: number = 4,
): Layer[] {
  const s = sigwxScale(mapZoom);
  const layers: Layer[] = [];

  const byType = new Map<string, SigwxGeoJSON[]>();
  for (const f of features) {
    const phen = f.properties.phenomenon;
    if (!byType.has(phen)) byType.set(phen, []);
    byType.get(phen)!.push(f);
  }

  // ── CB CLOUD — red scalloped lines ─────────────────────────────────

  const clouds = byType.get('CLOUD');
  if (clouds?.length) {
    const lineColor = OUTLINE_COLORS.CLOUD;
    const textColor = LABEL_COLORS.CLOUD;
    const cbItems = clouds.filter((d) => d.properties.cloud_type_code === '9');
    const nonCbItems = clouds.filter((d) => d.properties.cloud_type_code !== '9');

    // Light fill
    layers.push(new SolidPolygonLayer({
      id: 'sigwx-fill-cloud',
      data: clouds,
      getPolygon: (d: SigwxGeoJSON) => smoothRing(d.geometry.coordinates[0]),
      getFillColor: [lineColor[0], lineColor[1], lineColor[2], 20],
      pickable: false,
    }));

    if (cbItems.length > 0) {
      layers.push(new PathLayer({
        id: 'sigwx-outline-cb',
        data: cbItems,
        getPath: (d: SigwxGeoJSON) => generateScallopedRing(smoothRing(d.geometry.coordinates[0]), 1.5),
        getColor: lineColor,
        getWidth: 2.5,
        widthUnits: 'pixels',
        widthMinPixels: 1,
        pickable: false,
      }));
    }
    if (nonCbItems.length > 0) {
      layers.push(new PathLayer({
        id: 'sigwx-outline-cloud',
        data: nonCbItems,
        getPath: (d: SigwxGeoJSON) => smoothRing(d.geometry.coordinates[0]),
        getColor: lineColor,
        getWidth: 2,
        widthUnits: 'pixels',
        widthMinPixels: 1,
        pickable: false,
      }));
    }

    // Call-out labels (ICAO style: "OCNL CB\nXXX/320")
    const labels = clouds.map((d) => {
      const ring = d.geometry.coordinates[0] as [number, number][];
      const dist = CLOUD_DIST[d.properties.cloud_distribution_code] ?? '';
      const isCb = d.properties.cloud_type_code === '9';
      const type = isCb ? 'CB' : 'CLD';
      let text = `${dist} ${type}`.trim();
      if (d.properties.upper_fl != null) text += `\nXXX/${d.properties.upper_fl}`;
      return { position: centroid(ring), text };
    });
    layers.push(new TextLayer({
      id: 'sigwx-label-cloud',
      data: labels,
      getPosition: (d) => d.position,
      getText: (d) => d.text,
      getSize: 12 * s,
      getColor: textColor,
      getTextAnchor: 'middle',
      getAlignmentBaseline: 'center',
      fontFamily: 'monospace',
      fontWeight: 'bold',
      sizeUnits: 'pixels',
      pickable: false,
      background: true,
      getBackgroundColor: CALLOUT_BG,
      backgroundPadding: CALLOUT_PADDING,
      outlineWidth: 1,
      outlineColor: [0, 0, 0, 120],
    }));
  }

  // ── TURBULENCE — dark grey dashed lines ────────────────────────────

  const turbItems = byType.get('TURBULENCE');
  if (turbItems?.length) {
    const lineColor = OUTLINE_COLORS.TURBULENCE;
    const textColor = LABEL_COLORS.TURBULENCE;

    // Grey fill (darker for severe)
    layers.push(new SolidPolygonLayer({
      id: 'sigwx-fill-turb',
      data: turbItems,
      getPolygon: (d: SigwxGeoJSON) => smoothRing(d.geometry.coordinates[0]),
      getFillColor: (d: SigwxGeoJSON) => {
        const isSev = TURBULENCE_IS_SEVERE[d.properties.DegreeOfTurbulence_code];
        return isSev ? [100, 100, 100, 50] : [160, 160, 160, 30];
      },
      pickable: false,
    }));

    // Dashed outline
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- PathStyleExtension dash props not in PathLayer typings
    layers.push(new (PathLayer as any)({
      id: 'sigwx-outline-turb',
      data: turbItems,
      getPath: (d: SigwxGeoJSON) => smoothRing(d.geometry.coordinates[0]),
      getColor: lineColor,
      getWidth: 2.5,
      widthUnits: 'pixels',
      widthMinPixels: 1,
      getDashArray: [8, 5],
      extensions: [new PathStyleExtension({ dash: true })],
      pickable: false,
    }));

    // Turbulence symbol at centroid
    if (sigwxAtlas) {
      layers.push(new IconLayer({
        id: 'sigwx-symbol-turb',
        data: turbItems.map((d) => ({
          position: centroid(d.geometry.coordinates[0]),
          icon: TURBULENCE_IS_SEVERE[d.properties.DegreeOfTurbulence_code] ? 'turb_sev' : 'turb_mod',
        })),
        getPosition: (d) => d.position,
        getIcon: (d) => d.icon,
        getSize: 32 * s,
        iconAtlas: sigwxAtlas.atlas,
        iconMapping: sigwxAtlas.mapping,
        sizeUnits: 'pixels',
        pickable: false,
        getPixelOffset: [0, -18 * s],
      }));
    }

    // Call-out: "MOD TURB\nFL340/400"
    layers.push(new TextLayer({
      id: 'sigwx-label-turb',
      data: turbItems.map((d) => {
        const sev = TURBULENCE_LABEL[d.properties.DegreeOfTurbulence_code] ?? '';
        return {
          position: centroid(d.geometry.coordinates[0]),
          text: `${sev} TURB\nFL${flRange(d.properties)}`,
        };
      }),
      getPosition: (d) => d.position,
      getText: (d) => d.text,
      getSize: 11 * s,
      getColor: textColor,
      getTextAnchor: 'middle',
      getAlignmentBaseline: 'center',
      fontFamily: 'monospace',
      fontWeight: 'bold',
      sizeUnits: 'pixels',
      pickable: false,
      getPixelOffset: [0, 12 * s],
      background: true,
      getBackgroundColor: CALLOUT_BG,
      backgroundPadding: CALLOUT_PADDING,
      outlineWidth: 1,
      outlineColor: [0, 0, 0, 120],
    }));
  }

  // ── ICING — purple outline ─────────────────────────────────────────

  const iceItems = byType.get('AIRFRAME_ICING');
  if (iceItems?.length) {
    const lineColor = OUTLINE_COLORS.AIRFRAME_ICING;
    const textColor = LABEL_COLORS.AIRFRAME_ICING;

    // Purple fill (darker for severe)
    layers.push(new SolidPolygonLayer({
      id: 'sigwx-fill-ice',
      data: iceItems,
      getPolygon: (d: SigwxGeoJSON) => smoothRing(d.geometry.coordinates[0]),
      getFillColor: (d: SigwxGeoJSON) => {
        const isSev = ICING_IS_SEVERE[d.properties.DegreeOfIcing_code];
        return isSev ? [140, 50, 180, 50] : [140, 50, 180, 25];
      },
      pickable: false,
    }));

    layers.push(new PathLayer({
      id: 'sigwx-outline-ice',
      data: iceItems,
      getPath: (d: SigwxGeoJSON) => smoothRing(d.geometry.coordinates[0]),
      getColor: lineColor,
      getWidth: 2,
      widthUnits: 'pixels',
      widthMinPixels: 1,
      pickable: false,
    }));

    // Icing symbol at centroid
    if (sigwxAtlas) {
      layers.push(new IconLayer({
        id: 'sigwx-symbol-ice',
        data: iceItems.map((d) => ({
          position: centroid(d.geometry.coordinates[0]),
          icon: ICING_IS_SEVERE[d.properties.DegreeOfIcing_code] ? 'ice_sev' : 'ice_mod',
        })),
        getPosition: (d) => d.position,
        getIcon: (d) => d.icon,
        getSize: 32 * s,
        iconAtlas: sigwxAtlas.atlas,
        iconMapping: sigwxAtlas.mapping,
        sizeUnits: 'pixels',
        pickable: false,
        getPixelOffset: [0, -18 * s],
      }));
    }

    // Call-out: "MOD ICE\nFL100/240"
    layers.push(new TextLayer({
      id: 'sigwx-label-ice',
      data: iceItems.map((d) => {
        const sev = ICING_LABEL[d.properties.DegreeOfIcing_code] ?? '';
        return {
          position: centroid(d.geometry.coordinates[0]),
          text: `${sev} ICE\nFL${flRange(d.properties)}`,
        };
      }),
      getPosition: (d) => d.position,
      getText: (d) => d.text,
      getSize: 11 * s,
      getColor: textColor,
      getTextAnchor: 'middle',
      getAlignmentBaseline: 'center',
      fontFamily: 'monospace',
      fontWeight: 'bold',
      sizeUnits: 'pixels',
      pickable: false,
      getPixelOffset: [0, 12 * s],
      background: true,
      getBackgroundColor: CALLOUT_BG,
      backgroundPadding: CALLOUT_PADDING,
      outlineWidth: 1,
      outlineColor: [0, 0, 0, 120],
    }));
  }

  // ── TROPOPAUSE — thin blue dotted ──────────────────────────────────

  const tropItems = byType.get('TROPOPAUSE');
  if (tropItems?.length) {
    const lineColor = OUTLINE_COLORS.TROPOPAUSE;
    const textColor = LABEL_COLORS.TROPOPAUSE;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- PathStyleExtension dash props not in PathLayer typings
    layers.push(new (PathLayer as any)({
      id: 'sigwx-outline-trop',
      data: tropItems,
      getPath: (d: SigwxGeoJSON) => smoothRing(d.geometry.coordinates[0]),
      getColor: lineColor,
      getWidth: 1.5,
      widthUnits: 'pixels',
      widthMinPixels: 1,
      getDashArray: [4, 3],
      extensions: [new PathStyleExtension({ dash: true })],
      pickable: false,
    }));

    layers.push(new TextLayer({
      id: 'sigwx-label-trop',
      data: tropItems.map((d) => ({
        position: centroid(d.geometry.coordinates[0]),
        text: d.properties.elevation_fl ? `FL${d.properties.elevation_fl}` : 'TROP',
      })),
      getPosition: (d) => d.position,
      getText: (d) => d.text,
      getSize: 12 * s,
      getColor: textColor,
      getTextAnchor: 'middle',
      getAlignmentBaseline: 'center',
      fontFamily: 'monospace',
      fontWeight: 'bold',
      sizeUnits: 'pixels',
      pickable: false,
    }));
  }

  // ── JET STREAMS — thick black line with wind barbs and FL labels ───

  const jets = byType.get('JETSTREAM');
  if (jets?.length) {
    const lineColor = OUTLINE_COLORS.JETSTREAM;

    // Thick continuous line
    layers.push(new PathLayer({
      id: 'sigwx-jet-line',
      data: jets,
      getPath: (d: SigwxGeoJSON) => interpolateSpline(d.geometry.coordinates as [number, number][], 10),
      getColor: lineColor,
      getWidth: 4,
      widthUnits: 'pixels',
      widthMinPixels: 2,
      pickable: false,
    }));

    // Wind barbs along the jet axis
    if (jetBarbAtlas && jetBarbMapping) {
      const barbData: { position: [number, number]; speed: number; angle: number }[] = [];
      for (const jet of jets) {
        const symbols = jet.properties.wind_symbols ?? [];
        const coords = jet.geometry.coordinates as [number, number][];
        for (const sym of symbols) {
          if (!sym.position || !sym.speed_kt) continue;
          const pos = sym.position as [number, number];
          let angle = 0;
          let minDist = Infinity;
          let closestIdx = 0;
          for (let ci = 0; ci < coords.length; ci++) {
            const dx = coords[ci][0] - pos[0];
            const dy = coords[ci][1] - pos[1];
            const dist = dx * dx + dy * dy;
            if (dist < minDist) { minDist = dist; closestIdx = ci; }
          }
          if (closestIdx < coords.length - 1) {
            angle = bearing(coords[closestIdx], coords[closestIdx + 1]);
          } else if (closestIdx > 0) {
            angle = bearing(coords[closestIdx - 1], coords[closestIdx]);
          }
          barbData.push({ position: pos, speed: sym.speed_kt, angle: angle + 180 });
        }
      }

      if (barbData.length > 0) {
        layers.push(new IconLayer({
          id: 'sigwx-jet-barbs',
          data: barbData,
          getPosition: (d) => d.position,
          getIcon: (d) => getWindBarbKey(d.speed),
          getAngle: (d) => d.angle,
          getSize: 44 * s,
          iconAtlas: jetBarbAtlas,
          iconMapping: jetBarbMapping,
          sizeUnits: 'pixels',
          sizeMinPixels: 24,
          pickable: false,
        }));
      }
    }

    // Arrowhead at end of jet
    if (sigwxAtlas) {
      const arrowData: { position: [number, number]; angle: number }[] = [];
      for (const jet of jets) {
        const coords = jet.geometry.coordinates as [number, number][];
        if (coords.length >= 2) {
          arrowData.push({
            position: coords[coords.length - 1],
            angle: -bearing(coords[coords.length - 2], coords[coords.length - 1]),
          });
        }
      }
      layers.push(new IconLayer({
        id: 'sigwx-jet-arrows',
        data: arrowData,
        getPosition: (d) => d.position,
        getIcon: () => 'jet_arrow',
        getAngle: (d) => d.angle,
        getSize: 28 * s,
        iconAtlas: sigwxAtlas.atlas,
        iconMapping: sigwxAtlas.mapping,
        sizeUnits: 'pixels',
        pickable: false,
      }));
    }

    // FL labels in white call-out boxes along jet
    const flLabels: { position: [number, number]; text: string }[] = [];
    for (const jet of jets) {
      for (const sym of jet.properties.wind_symbols ?? []) {
        if (!sym.position || !sym.elevation_fl) continue;
        let text = `FL${sym.elevation_fl}`;
        if (sym.isotach_upper_fl && sym.isotach_lower_fl) {
          text += `\n${sym.speed_kt}KT\nFL${sym.isotach_lower_fl}/${sym.isotach_upper_fl}`;
        }
        flLabels.push({ position: sym.position, text });
      }
    }
    if (flLabels.length > 0) {
      layers.push(new TextLayer({
        id: 'sigwx-jet-fl',
        data: flLabels,
        getPosition: (d) => d.position,
        getText: (d) => d.text,
        getSize: 10 * s,
        getColor: [30, 30, 30, 255],
        getTextAnchor: 'start',
        getAlignmentBaseline: 'center',
        fontFamily: 'monospace',
        fontWeight: 'bold',
        sizeUnits: 'pixels',
        pickable: false,
        getPixelOffset: [16 * s, -6 * s],
        background: true,
        getBackgroundColor: CALLOUT_BG,
        backgroundPadding: CALLOUT_PADDING,
        outlineWidth: 1,
        outlineColor: [0, 0, 0, 150],
      }));
    }
  }

  // ── POINT PHENOMENA — ICAO symbols ─────────────────────────────────

  if (sigwxAtlas) {
    const pointDefs: Record<string, { icon: string; color: [number, number, number, number] }> = {
      VOLCANO: { icon: 'volcano', color: [180, 20, 20, 255] },
      TROPICAL_CYCLONE: { icon: 'tropical_cyclone', color: [120, 30, 170, 255] },
      SANDSTORM: { icon: 'sandstorm', color: [170, 130, 20, 255] },
      RADIATION: { icon: 'radiation', color: [170, 40, 170, 255] },
    };

    const pointData: { position: [number, number]; icon: string; label: string; color: [number, number, number, number] }[] = [];
    for (const [phen, def] of Object.entries(pointDefs)) {
      const items = byType.get(phen);
      if (!items?.length) continue;
      for (const item of items) {
        let label = item.properties.name ?? '';
        if (phen === 'RADIATION') label = label || 'RDOACT';
        pointData.push({
          position: item.geometry.coordinates as [number, number],
          icon: def.icon,
          label,
          color: def.color,
        });
      }
    }

    if (pointData.length > 0) {
      layers.push(
        new IconLayer({
          id: 'sigwx-point-icons',
          data: pointData,
          getPosition: (d) => d.position,
          getIcon: (d) => d.icon,
          getSize: 40 * s,
          iconAtlas: sigwxAtlas.atlas,
          iconMapping: sigwxAtlas.mapping,
          sizeUnits: 'pixels',
          sizeMinPixels: 24,
          pickable: false,
        }),
        new TextLayer({
          id: 'sigwx-point-labels',
          data: pointData,
          getPosition: (d) => d.position,
          getText: (d) => d.label,
          getSize: 11 * s,
          getColor: (d) => d.color,
          getTextAnchor: 'middle',
          getAlignmentBaseline: 'center',
          fontFamily: 'monospace',
          fontWeight: 'bold',
          sizeUnits: 'pixels',
          pickable: false,
          getPixelOffset: [0, -28 * s],
          background: true,
          getBackgroundColor: CALLOUT_BG,
          backgroundPadding: CALLOUT_PADDING,
          outlineWidth: 1,
          outlineColor: [0, 0, 0, 120],
        }),
      );
    }
  }

  return layers;
}
