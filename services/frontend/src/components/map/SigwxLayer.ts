import { PathLayer, TextLayer, IconLayer, SolidPolygonLayer } from '@deck.gl/layers';
import { PathStyleExtension } from '@deck.gl/extensions';
import type { Layer } from '@deck.gl/core';
import { interpolateSpline, generateScallopedRing } from '../../utils/splineInterpolation';
import { getWindBarbKey } from '../../utils/windBarbs';
import type { SigwxSymbolAtlas } from '../../utils/sigwxSymbols';

interface SigwxGeoJSON {
  type: 'Feature';
  geometry: {
    type: 'Point' | 'LineString' | 'Polygon';
    coordinates: any;
  };
  properties: Record<string, any>;
}

// Color scheme per phenomenon
const COLORS: Record<string, [number, number, number, number]> = {
  JETSTREAM: [20, 140, 60, 220],
  TURBULENCE: [180, 140, 0, 200],
  AIRFRAME_ICING: [140, 60, 180, 200],   // Purple per ICAO spec
  CLOUD: [220, 40, 40, 160],
  TROPOPAUSE: [100, 180, 240, 180],
  VOLCANO: [220, 30, 30, 255],
  TROPICAL_CYCLONE: [153, 40, 204, 255],
  SANDSTORM: [204, 153, 34, 255],
  RADIATION: [204, 51, 204, 255],
};

// WMO code tables for severity labels
const TURBULENCE_SEVERITY: Record<string, string> = {
  '4': 'LGT TURB', '6': 'LGT-MOD TURB', '8': 'MOD TURB',
  '10': 'SEV TURB', '12': 'EXTR TURB',
};
const TURBULENCE_IS_SEVERE: Record<string, boolean> = {
  '10': true, '12': true,
};

const ICING_SEVERITY: Record<string, string> = {
  '1': 'LGT ICE', '2': 'LGT ICE', '3': 'MOD ICE', '4': 'SEV ICE',
};
const ICING_IS_SEVERE: Record<string, boolean> = {
  '4': true,
};

const CLOUD_DISTRIBUTION: Record<string, string> = {
  '10': 'ISOL', '11': 'OCNL', '12': 'FRQ',
};

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

/** Compute centroid of a polygon ring. */
function centroid(ring: [number, number][]): [number, number] {
  const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  return [cx, cy];
}

/** Compute angle (degrees) from p1 to p2 for icon rotation. */
function bearing(p1: [number, number], p2: [number, number]): number {
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  return (Math.atan2(dx, dy) * 180) / Math.PI;
}

export function createSigwxLayers(
  features: SigwxGeoJSON[],
  sigwxAtlas?: SigwxSymbolAtlas | null,
  jetBarbAtlas?: string | null,
  jetBarbMapping?: Record<string, { x: number; y: number; width: number; height: number }> | null,
): Layer[] {
  const layers: Layer[] = [];

  // Group by phenomenon
  const byType = new Map<string, SigwxGeoJSON[]>();
  for (const f of features) {
    const phen = f.properties.phenomenon;
    if (!byType.has(phen)) byType.set(phen, []);
    byType.get(phen)!.push(f);
  }

  // ── POLYGON PHENOMENA ──────────────────────────────────────────────

  // CB Cloud — red scalloped boundary with fill
  const clouds = byType.get('CLOUD');
  if (clouds?.length) {
    const color = COLORS.CLOUD;
    const cbItems = clouds.filter((d) => d.properties.cloud_type_code === '9');
    const nonCbItems = clouds.filter((d) => d.properties.cloud_type_code !== '9');

    // Fill for all clouds
    layers.push(
      new SolidPolygonLayer({
        id: 'sigwx-fill-cloud',
        data: clouds,
        getPolygon: (d: SigwxGeoJSON) => smoothRing(d.geometry.coordinates[0]),
        getFillColor: [color[0], color[1], color[2], 30],
        pickable: false,
      }),
    );

    // Scalloped outline for CB
    if (cbItems.length > 0) {
      layers.push(
        new PathLayer({
          id: 'sigwx-outline-cloud-cb',
          data: cbItems,
          getPath: (d: SigwxGeoJSON) =>
            generateScallopedRing(smoothRing(d.geometry.coordinates[0]), 1.5),
          getColor: color,
          getWidth: 2.5,
          widthUnits: 'pixels',
          widthMinPixels: 1,
          pickable: false,
        }),
      );
    }
    if (nonCbItems.length > 0) {
      layers.push(
        new PathLayer({
          id: 'sigwx-outline-cloud-other',
          data: nonCbItems,
          getPath: (d: SigwxGeoJSON) => smoothRing(d.geometry.coordinates[0]),
          getColor: color,
          getWidth: 2,
          widthUnits: 'pixels',
          widthMinPixels: 1,
          pickable: false,
        }),
      );
    }

    // CB labels
    const cloudLabels = clouds.map((d) => {
      const ring = d.geometry.coordinates[0] as [number, number][];
      const pos = centroid(ring);
      const dist = CLOUD_DISTRIBUTION[d.properties.cloud_distribution_code] ?? '';
      const isCb = d.properties.cloud_type_code === '9';
      let label = isCb ? `${dist} CB`.trim() : `${dist} CLD`.trim();
      if (d.properties.upper_fl) label += `\nTOP FL${d.properties.upper_fl}`;
      return { position: pos, text: label };
    });
    layers.push(
      new TextLayer({
        id: 'sigwx-label-cloud',
        data: cloudLabels,
        getPosition: (d) => d.position,
        getText: (d) => d.text,
        getSize: 13,
        getColor: [color[0], color[1], color[2], 255],
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'center',
        fontFamily: 'monospace',
        fontWeight: 'bold',
        sizeUnits: 'pixels',
        pickable: false,
        background: true,
        getBackgroundColor: [10, 15, 30, 180],
        backgroundPadding: [4, 2],
      }),
    );
  }

  // Turbulence — thick dashed lines with turbulence symbol at centroid
  const turbItems = byType.get('TURBULENCE');
  if (turbItems?.length) {
    const color = COLORS.TURBULENCE;

    layers.push(
      new (PathLayer as any)({
        id: 'sigwx-outline-turbulence',
        data: turbItems,
        getPath: (d: SigwxGeoJSON) => smoothRing(d.geometry.coordinates[0]),
        getColor: color,
        getWidth: 2.5,
        widthUnits: 'pixels',
        widthMinPixels: 1,
        getDashArray: [8, 5],
        extensions: [new PathStyleExtension({ dash: true })],
        pickable: false,
      }),
    );

    // Turbulence symbol icons at centroid
    if (sigwxAtlas) {
      const turbSymbolData = turbItems.map((d) => {
        const ring = d.geometry.coordinates[0] as [number, number][];
        const isSevere = TURBULENCE_IS_SEVERE[d.properties.DegreeOfTurbulence_code];
        return {
          position: centroid(ring),
          icon: isSevere ? 'turb_sev' : 'turb_mod',
        };
      });
      layers.push(
        new IconLayer({
          id: 'sigwx-symbol-turbulence',
          data: turbSymbolData,
          getPosition: (d) => d.position,
          getIcon: (d) => d.icon,
          getSize: 36,
          iconAtlas: sigwxAtlas.atlas,
          iconMapping: sigwxAtlas.mapping,
          sizeUnits: 'pixels',
          pickable: false,
          getPixelOffset: [0, -20],
        }),
      );
    }

    // Labels
    const turbLabels = turbItems.map((d) => {
      const ring = d.geometry.coordinates[0] as [number, number][];
      const code = d.properties.DegreeOfTurbulence_code;
      let label = TURBULENCE_SEVERITY[code] ?? 'TURB';
      if (d.properties.upper_fl && d.properties.lower_fl) {
        label += `\nFL${d.properties.lower_fl}/${d.properties.upper_fl}`;
      }
      return { position: centroid(ring), text: label };
    });
    layers.push(
      new TextLayer({
        id: 'sigwx-label-turbulence',
        data: turbLabels,
        getPosition: (d) => d.position,
        getText: (d) => d.text,
        getSize: 12,
        getColor: [color[0], color[1], color[2], 255],
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'center',
        fontFamily: 'monospace',
        fontWeight: 'bold',
        sizeUnits: 'pixels',
        pickable: false,
        getPixelOffset: [0, 10],
        background: true,
        getBackgroundColor: [10, 15, 30, 180],
        backgroundPadding: [4, 2],
      }),
    );
  }

  // Icing — purple outline with icing symbol
  const iceItems = byType.get('AIRFRAME_ICING');
  if (iceItems?.length) {
    const color = COLORS.AIRFRAME_ICING;

    layers.push(
      new PathLayer({
        id: 'sigwx-outline-icing',
        data: iceItems,
        getPath: (d: SigwxGeoJSON) => smoothRing(d.geometry.coordinates[0]),
        getColor: color,
        getWidth: 2,
        widthUnits: 'pixels',
        widthMinPixels: 1,
        pickable: false,
      }),
    );

    if (sigwxAtlas) {
      const iceSymbolData = iceItems.map((d) => {
        const ring = d.geometry.coordinates[0] as [number, number][];
        const isSevere = ICING_IS_SEVERE[d.properties.DegreeOfIcing_code];
        return {
          position: centroid(ring),
          icon: isSevere ? 'ice_sev' : 'ice_mod',
        };
      });
      layers.push(
        new IconLayer({
          id: 'sigwx-symbol-icing',
          data: iceSymbolData,
          getPosition: (d) => d.position,
          getIcon: (d) => d.icon,
          getSize: 36,
          iconAtlas: sigwxAtlas.atlas,
          iconMapping: sigwxAtlas.mapping,
          sizeUnits: 'pixels',
          pickable: false,
          getPixelOffset: [0, -20],
        }),
      );
    }

    const iceLabels = iceItems.map((d) => {
      const ring = d.geometry.coordinates[0] as [number, number][];
      const code = d.properties.DegreeOfIcing_code;
      let label = ICING_SEVERITY[code] ?? 'ICE';
      if (d.properties.upper_fl && d.properties.lower_fl) {
        label += `\nFL${d.properties.lower_fl}/${d.properties.upper_fl}`;
      }
      return { position: centroid(ring), text: label };
    });
    layers.push(
      new TextLayer({
        id: 'sigwx-label-icing',
        data: iceLabels,
        getPosition: (d) => d.position,
        getText: (d) => d.text,
        getSize: 12,
        getColor: [color[0], color[1], color[2], 255],
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'center',
        fontFamily: 'monospace',
        fontWeight: 'bold',
        sizeUnits: 'pixels',
        pickable: false,
        getPixelOffset: [0, 10],
        background: true,
        getBackgroundColor: [10, 15, 30, 180],
        backgroundPadding: [4, 2],
      }),
    );
  }

  // Tropopause — thin blue dotted contour
  const tropItems = byType.get('TROPOPAUSE');
  if (tropItems?.length) {
    const color = COLORS.TROPOPAUSE;

    layers.push(
      new (PathLayer as any)({
        id: 'sigwx-outline-tropopause',
        data: tropItems,
        getPath: (d: SigwxGeoJSON) => smoothRing(d.geometry.coordinates[0]),
        getColor: color,
        getWidth: 1.5,
        widthUnits: 'pixels',
        widthMinPixels: 1,
        getDashArray: [4, 3],
        extensions: [new PathStyleExtension({ dash: true })],
        pickable: false,
      }),
    );

    const tropLabels = tropItems.map((d) => {
      const ring = d.geometry.coordinates[0] as [number, number][];
      return {
        position: centroid(ring),
        text: d.properties.elevation_fl ? `FL${d.properties.elevation_fl}` : 'TROP',
      };
    });
    layers.push(
      new TextLayer({
        id: 'sigwx-label-tropopause',
        data: tropLabels,
        getPosition: (d) => d.position,
        getText: (d) => d.text,
        getSize: 12,
        getColor: [color[0], color[1], color[2], 255],
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'center',
        fontFamily: 'monospace',
        fontWeight: 'bold',
        sizeUnits: 'pixels',
        pickable: false,
      }),
    );
  }

  // ── JET STREAMS ────────────────────────────────────────────────────

  const jets = byType.get('JETSTREAM');
  if (jets?.length) {
    const jetColor = COLORS.JETSTREAM;

    // Thick continuous line (smooth spline)
    layers.push(
      new PathLayer({
        id: 'sigwx-jet-line',
        data: jets,
        getPath: (d: SigwxGeoJSON) =>
          interpolateSpline(d.geometry.coordinates as [number, number][], 10),
        getColor: jetColor,
        getWidth: 3.5,
        widthUnits: 'pixels',
        widthMinPixels: 2,
        pickable: false,
      }),
    );

    // Wind barbs along the jet axis at wind symbol positions
    if (jetBarbAtlas && jetBarbMapping) {
      const barbData: { position: [number, number]; speed: number; angle: number }[] = [];
      for (const jet of jets) {
        const symbols = jet.properties.wind_symbols ?? [];
        const coords = jet.geometry.coordinates as [number, number][];
        for (let si = 0; si < symbols.length; si++) {
          const sym = symbols[si];
          if (!sym.position || !sym.speed_kt) continue;

          // Compute bearing from this point to next along jet for barb orientation
          let angle = 0;
          const pos = sym.position as [number, number];
          // Find closest coord index for direction
          let minDist = Infinity;
          let closestIdx = 0;
          for (let ci = 0; ci < coords.length; ci++) {
            const dx = coords[ci][0] - pos[0];
            const dy = coords[ci][1] - pos[1];
            const dist = dx * dx + dy * dy;
            if (dist < minDist) {
              minDist = dist;
              closestIdx = ci;
            }
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
        layers.push(
          new IconLayer({
            id: 'sigwx-jet-barbs',
            data: barbData,
            getPosition: (d) => d.position,
            getIcon: (d) => getWindBarbKey(d.speed),
            getAngle: (d) => d.angle,
            getSize: 44,
            iconAtlas: jetBarbAtlas,
            iconMapping: jetBarbMapping,
            sizeUnits: 'pixels',
            sizeMinPixels: 24,
            pickable: false,
          }),
        );
      }
    }

    // Arrowhead at end of jet
    if (sigwxAtlas) {
      const arrowData: { position: [number, number]; angle: number }[] = [];
      for (const jet of jets) {
        const coords = jet.geometry.coordinates as [number, number][];
        if (coords.length >= 2) {
          const last = coords[coords.length - 1];
          const prev = coords[coords.length - 2];
          arrowData.push({
            position: last,
            angle: -bearing(prev, last),
          });
        }
      }
      layers.push(
        new IconLayer({
          id: 'sigwx-jet-arrows',
          data: arrowData,
          getPosition: (d) => d.position,
          getIcon: () => 'jet_arrow',
          getAngle: (d) => d.angle,
          getSize: 28,
          iconAtlas: sigwxAtlas.atlas,
          iconMapping: sigwxAtlas.mapping,
          sizeUnits: 'pixels',
          pickable: false,
        }),
      );
    }

    // FL labels along jet with boxed background
    const flLabels: { position: [number, number]; text: string }[] = [];
    for (const jet of jets) {
      const symbols = jet.properties.wind_symbols ?? [];
      for (const sym of symbols) {
        if (sym.position && sym.elevation_fl) {
          const label = `FL${sym.elevation_fl}`;
          // Add isotach depth info if available
          let text = label;
          if (sym.isotach_upper_fl && sym.isotach_lower_fl) {
            text += `\n${sym.speed_kt}kt\nFL${sym.isotach_lower_fl}/${sym.isotach_upper_fl}`;
          }
          flLabels.push({ position: sym.position, text });
        }
      }
    }
    if (flLabels.length > 0) {
      layers.push(
        new TextLayer({
          id: 'sigwx-jet-fl-labels',
          data: flLabels,
          getPosition: (d) => d.position,
          getText: (d) => d.text,
          getSize: 11,
          getColor: [jetColor[0], jetColor[1], jetColor[2], 255],
          getTextAnchor: 'start',
          getAlignmentBaseline: 'center',
          fontFamily: 'monospace',
          fontWeight: 'bold',
          sizeUnits: 'pixels',
          pickable: false,
          getPixelOffset: [18, -8],
          background: true,
          getBackgroundColor: [10, 15, 30, 200],
          backgroundPadding: [4, 2],
        }),
      );
    }
  }

  // ── POINT PHENOMENA with ICAO symbols ──────────────────────────────

  if (sigwxAtlas) {
    const pointSymbolMap: Record<string, string> = {
      VOLCANO: 'volcano',
      TROPICAL_CYCLONE: 'tropical_cyclone',
      RADIATION: 'radiation',
      SANDSTORM: 'sandstorm',
    };

    const pointData: { position: [number, number]; icon: string; label: string; color: [number, number, number, number] }[] = [];
    for (const phen of ['VOLCANO', 'TROPICAL_CYCLONE', 'SANDSTORM', 'RADIATION']) {
      const items = byType.get(phen);
      if (!items?.length) continue;
      const color = COLORS[phen] ?? [128, 128, 128, 255];
      const iconName = pointSymbolMap[phen] ?? phen.toLowerCase();

      for (const item of items) {
        let label = item.properties.name ?? '';
        if (phen === 'RADIATION') label = label || 'RDOACT';
        pointData.push({
          position: item.geometry.coordinates as [number, number],
          icon: iconName,
          label,
          color,
        });
      }
    }

    if (pointData.length > 0) {
      layers.push(
        new IconLayer({
          id: 'sigwx-point-symbols',
          data: pointData,
          getPosition: (d) => d.position,
          getIcon: (d) => d.icon,
          getSize: 40,
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
          getSize: 12,
          getColor: (d) => d.color,
          getTextAnchor: 'middle',
          getAlignmentBaseline: 'center',
          fontFamily: 'monospace',
          fontWeight: 'bold',
          sizeUnits: 'pixels',
          pickable: false,
          getPixelOffset: [0, -28],
          background: true,
          getBackgroundColor: [10, 15, 30, 200],
          backgroundPadding: [4, 2],
        }),
      );
    }
  }

  return layers;
}
