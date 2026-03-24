import { PathLayer, TextLayer, ScatterplotLayer, SolidPolygonLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';

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

    // For CLOUD/CB, add a semi-transparent fill
    if (phen === 'CLOUD') {
      layers.push(
        new SolidPolygonLayer({
          id: `sigwx-fill-${phen}`,
          data: items,
          getPolygon: (d: SigwxGeoJSON) => d.geometry.coordinates[0],
          getFillColor: [color[0], color[1], color[2], 40],
          pickable: false,
        }),
      );
    }

    // Outlines
    layers.push(
      new PathLayer({
        id: `sigwx-outline-${phen}`,
        data: items,
        getPath: (d: SigwxGeoJSON) => d.geometry.coordinates[0],
        getColor: color,
        getWidth: phen === 'TROPOPAUSE' ? 1.5 : 2,
        widthUnits: 'pixels',
        widthMinPixels: 1,
        pickable: false,
      }),
    );

    // Labels at polygon centroid
    const labelData = items.map((d) => {
      const ring = d.geometry.coordinates[0] as [number, number][];
      const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
      const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
      const props = d.properties;
      let label = phen.replace('AIRFRAME_', '');
      if (props.upper_fl && props.lower_fl) {
        label += `\nFL${props.lower_fl}-${props.upper_fl}`;
      } else if (props.elevation_fl) {
        label = `FL${props.elevation_fl}`;
      }
      if (props.cloud_type_code === '9') label = 'CB\n' + label;
      return { position: [cx, cy] as [number, number], text: label };
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
      }),
    );
  }

  // Jet streams — line + speed labels at wind symbol positions
  const jets = byType.get('JETSTREAM');
  if (jets?.length) {
    const jetColor = COLORS.JETSTREAM;

    layers.push(
      new PathLayer({
        id: 'sigwx-jet-line',
        data: jets,
        getPath: (d: SigwxGeoJSON) => d.geometry.coordinates,
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
