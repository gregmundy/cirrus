import { ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import type { PickingInfo } from '@deck.gl/core';
import type { StationObs } from '../../stores/appStore';

const FLIGHT_CAT_COLORS: Record<string, [number, number, number, number]> = {
  VFR:  [0, 200, 0, 220],
  MVFR: [0, 100, 255, 220],
  IFR:  [220, 0, 0, 220],
  LIFR: [200, 0, 200, 220],
};

const DEFAULT_COLOR: [number, number, number, number] = [150, 150, 150, 180];

export function createStationDotsLayer(
  data: StationObs[],
  onClick: (info: PickingInfo<StationObs>) => void,
): Layer | null {
  if (data.length === 0) return null;

  return new ScatterplotLayer<StationObs>({
    id: 'station-dots',
    data,
    getPosition: (d) => [d.longitude, d.latitude],
    getFillColor: (d) => FLIGHT_CAT_COLORS[d.flight_category ?? ''] ?? DEFAULT_COLOR,
    getRadius: 4,
    radiusUnits: 'pixels',
    radiusMinPixels: 3,
    radiusMaxPixels: 8,
    pickable: true,
    antialiasing: true,
    onClick,
  });
}

export function createStationLabelsLayer(data: StationObs[]): Layer | null {
  if (data.length === 0) return null;

  return new TextLayer<StationObs>({
    id: 'station-ids',
    data,
    getPosition: (d) => [d.longitude, d.latitude],
    getText: (d) => d.station,
    getSize: 10,
    getColor: [220, 220, 220, 200],
    getTextAnchor: 'start',
    getAlignmentBaseline: 'center',
    getPixelOffset: [8, 0],
    fontFamily: 'monospace',
    fontWeight: 'bold',
    sizeUnits: 'pixels',
    pickable: false,
  });
}
