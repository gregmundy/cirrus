import { PathLayer, TextLayer, ScatterplotLayer, SolidPolygonLayer } from '@deck.gl/layers';
import { PathStyleExtension } from '@deck.gl/extensions';
import type { Layer } from '@deck.gl/core';
import { interpolateSpline, generateScallopedRing } from '../../utils/splineInterpolation';

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
  TURBULENCE: [255, 160, 0, 180],
  AIRFRAME_ICING: [0, 180, 220, 180],
  CLOUD: [220, 40, 40, 160],
  TROPOPAUSE: [100, 180, 240, 180],
  VOLCANO: [220, 30, 30, 255],
  TROPICAL_CYCLONE: [160, 40, 200, 255],
  SANDSTORM: [220, 180, 30, 255],
  RADIATION: [200, 40, 200, 255],
};

// WMO code tables for severity labels
const TURBULENCE_SEVERITY: Record<string, string> = {
  '4': 'LGT TURB', '6': 'LGT-MOD TURB', '8': 'MOD TURB',
  '10': 'SEV TURB', '12': 'EXTR TURB',
};

const ICING_SEVERITY: Record<string, string> = {
  '1': 'LGT ICE', '2': 'LGT ICE', '3': 'MOD ICE', '4': 'SEV ICE',
};

const CLOUD_DISTRIBUTION: Record<string, string> = {
  '10': 'ISOL', '11': 'OCNL', '12': 'FRQ',
};

// Label pixel offsets per phenomenon to reduce overlap
const LABEL_OFFSETS: Record<string, [number, number]> = {
  TURBULENCE: [0, 0],
  AIRFRAME_ICING: [0, 8],
  CLOUD: [0, -8],
  TROPOPAUSE: [0, 0],
};

/** Smooth a polygon ring using cubic spline interpolation. */
function smoothRing(ring: [number, number][]): [number, number][] {
  if (ring.length < 4) return ring;
  // Remove closing point, interpolate, then close
  const open = ring.slice(0, -1);
  // Close the loop for interpolation by appending first few points
  const looped = [...open, open[0], open[1]];
  const smooth = interpolateSpline(looped, 8);
  // Trim the extra wrap-around and close
  const trimmed = smooth.slice(0, smooth.length - 16);
  if (trimmed.length > 0) trimmed.push(trimmed[0]);
  return trimmed;
}

export function createSigwxLayers(features: SigwxGeoJSON[]): Layer[] {
  const layers: Layer[] = [];

  // Group by phenomenon
  const byType = new Map<string, SigwxGeoJSON[]>();
  for (const f of features) {
    const phen = f.properties.phenomenon;
    if (!byType.has(phen)) byType.set(phen, []);
    byType.get(phen)!.push(f);
  }

  // Polygon phenomena — outlines via PathLayer
  for (const phen of ['TURBULENCE', 'AIRFRAME_ICING', 'CLOUD', 'TROPOPAUSE']) {
    const items = byType.get(phen);
    if (!items?.length) continue;
    const color = COLORS[phen] ?? [128, 128, 128, 180];

    // For CLOUD/CB, add a semi-transparent fill (using smooth boundary)
    if (phen === 'CLOUD') {
      layers.push(
        new SolidPolygonLayer({
          id: `sigwx-fill-${phen}`,
          data: items,
          getPolygon: (d: SigwxGeoJSON) => smoothRing(d.geometry.coordinates[0]),
          getFillColor: [color[0], color[1], color[2], 40],
          pickable: false,
        }),
      );
    }

    // Outlines — smooth with splines; CB gets scallops; turbulence gets dashing
    if (phen === 'TURBULENCE') {
      // Dashed outline for turbulence
      layers.push(
        new (PathLayer as any)({
          id: `sigwx-outline-${phen}`,
          data: items,
          getPath: (d: SigwxGeoJSON) => smoothRing(d.geometry.coordinates[0]),
          getColor: color,
          getWidth: 2,
          widthUnits: 'pixels',
          widthMinPixels: 1,
          getDashArray: [6, 4],
          extensions: [new PathStyleExtension({ dash: true })],
          pickable: false,
        }),
      );
    } else if (phen === 'CLOUD') {
      // CB gets scalloped outline; non-CB gets smooth outline
      const cbItems = items.filter((d) => d.properties.cloud_type_code === '9');
      const nonCbItems = items.filter((d) => d.properties.cloud_type_code !== '9');

      if (cbItems.length > 0) {
        layers.push(
          new PathLayer({
            id: `sigwx-outline-${phen}-cb`,
            data: cbItems,
            getPath: (d: SigwxGeoJSON) =>
              generateScallopedRing(smoothRing(d.geometry.coordinates[0]), 1.5),
            getColor: color,
            getWidth: 2,
            widthUnits: 'pixels',
            widthMinPixels: 1,
            pickable: false,
          }),
        );
      }
      if (nonCbItems.length > 0) {
        layers.push(
          new PathLayer({
            id: `sigwx-outline-${phen}-other`,
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
    } else {
      // Standard smooth outline
      layers.push(
        new PathLayer({
          id: `sigwx-outline-${phen}`,
          data: items,
          getPath: (d: SigwxGeoJSON) => smoothRing(d.geometry.coordinates[0]),
          getColor: color,
          getWidth: phen === 'TROPOPAUSE' ? 1.5 : 2,
          widthUnits: 'pixels',
          widthMinPixels: 1,
          pickable: false,
        }),
      );
    }

    // Labels at polygon centroid with improved formatting
    const labelData = items.map((d) => {
      const ring = d.geometry.coordinates[0] as [number, number][];
      const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
      const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
      const props = d.properties;

      let label = '';
      if (phen === 'TURBULENCE') {
        const code = props.DegreeOfTurbulence_code;
        label = TURBULENCE_SEVERITY[code] ?? 'TURB';
        if (props.upper_fl && props.lower_fl) {
          label += `\nFL${props.lower_fl}/${props.upper_fl}`;
        }
      } else if (phen === 'AIRFRAME_ICING') {
        const code = props.DegreeOfIcing_code;
        label = ICING_SEVERITY[code] ?? 'ICE';
        if (props.upper_fl && props.lower_fl) {
          label += `\nFL${props.lower_fl}/${props.upper_fl}`;
        }
      } else if (phen === 'CLOUD') {
        const dist = CLOUD_DISTRIBUTION[props.cloud_distribution_code] ?? '';
        const isCb = props.cloud_type_code === '9';
        label = isCb ? `${dist} CB`.trim() : `${dist} CLD`.trim();
        if (props.upper_fl) {
          label += `\nTOP FL${props.upper_fl}`;
        }
      } else if (phen === 'TROPOPAUSE') {
        label = props.elevation_fl ? `FL${props.elevation_fl}` : 'TROP';
      }

      return {
        position: [cx, cy] as [number, number],
        text: label,
        offset: LABEL_OFFSETS[phen] ?? [0, 0],
      };
    });

    layers.push(
      new TextLayer({
        id: `sigwx-label-${phen}`,
        data: labelData,
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
        getPixelOffset: (d) => d.offset,
      }),
    );
  }

  // Jet streams — smooth spline line + speed labels
  const jets = byType.get('JETSTREAM');
  if (jets?.length) {
    const jetColor = COLORS.JETSTREAM;

    layers.push(
      new PathLayer({
        id: 'sigwx-jet-line',
        data: jets,
        getPath: (d: SigwxGeoJSON) =>
          interpolateSpline(d.geometry.coordinates as [number, number][], 10),
        getColor: jetColor,
        getWidth: 3,
        widthUnits: 'pixels',
        widthMinPixels: 2,
        pickable: false,
      }),
    );

    // Wind symbol labels (speed + FL at each symbol position)
    const symbolData: { position: [number, number]; text: string }[] = [];
    for (const jet of jets) {
      const symbols = jet.properties.wind_symbols ?? [];
      for (const sym of symbols) {
        if (sym.position && sym.speed_kt) {
          symbolData.push({
            position: sym.position as [number, number],
            text: `${sym.speed_kt}kt\nFL${sym.elevation_fl ?? '???'}`,
          });
        }
      }
    }

    if (symbolData.length > 0) {
      layers.push(
        new TextLayer({
          id: 'sigwx-jet-labels',
          data: symbolData,
          getPosition: (d) => d.position,
          getText: (d) => d.text,
          getSize: 11,
          getColor: [jetColor[0], jetColor[1], jetColor[2], 255],
          getTextAnchor: 'middle',
          getAlignmentBaseline: 'center',
          fontFamily: 'monospace',
          fontWeight: 'bold',
          sizeUnits: 'pixels',
          pickable: false,
          getPixelOffset: [0, -15],
        }),
      );
    }
  }

  // Point phenomena — ScatterplotLayer + TextLayer for names
  const pointData: { position: [number, number]; color: [number, number, number, number]; radius: number; label: string; phenomenon: string }[] = [];
  for (const phen of ['VOLCANO', 'TROPICAL_CYCLONE', 'SANDSTORM', 'RADIATION']) {
    const items = byType.get(phen);
    if (!items?.length) continue;
    const color = COLORS[phen] ?? [128, 128, 128, 255];
    for (const item of items) {
      const name = item.properties.name ?? phen;
      pointData.push({
        position: item.geometry.coordinates as [number, number],
        color,
        radius: phen === 'VOLCANO' || phen === 'TROPICAL_CYCLONE' ? 8 : 5,
        label: name,
        phenomenon: phen,
      });
    }
  }

  if (pointData.length > 0) {
    layers.push(
      new ScatterplotLayer({
        id: 'sigwx-points',
        data: pointData,
        getPosition: (d) => d.position,
        getFillColor: (d) => d.color,
        getRadius: (d) => d.radius,
        radiusUnits: 'pixels',
        radiusMinPixels: 4,
        pickable: false,
      }),
      new TextLayer({
        id: 'sigwx-point-labels',
        data: pointData,
        getPosition: (d) => d.position,
        getText: (d) => d.label,
        getSize: 12,
        getColor: (d) => [d.color[0], d.color[1], d.color[2], 255] as [number, number, number, number],
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'center',
        fontFamily: 'monospace',
        fontWeight: 'bold',
        sizeUnits: 'pixels',
        pickable: false,
        getPixelOffset: [0, -16],
      }),
    );
  }

  return layers;
}
