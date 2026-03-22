import { PathLayer, TextLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import { computeContourLines } from '../../utils/contourComputation';
import type { ContourLine, ContourLabel } from '../../utils/contourComputation';
import { findExtrema } from '../../utils/extremaDetection';

export interface GriddedData {
  parameter: string;
  run_time: string;
  forecast_hour: number;
  valid_time: string;
  level_hpa: number;
  ni: number;
  nj: number;
  lats: number[];
  lons: number[];
  values: number[];
}

function kelvinToCelsius(k: number): number {
  return k - 273.15;
}

/**
 * Create temperature isotherm layers.
 * Converts K→°C, 5°C intervals, red lines and labels.
 */
export function createTemperatureLayers(data: GriddedData): Layer[] {
  const { lines, labels } = computeContourLines(
    data.ni, data.nj, data.lats, data.lons, data.values,
    {
      convertValue: kelvinToCelsius,
      formatLabel: (v) => `${v}°C`,
      interval: 5,
      upsampleFactor: 4,
      splitOnLonWrap: true,
    },
  );

  if (lines.length === 0) return [];

  return [
    new PathLayer<ContourLine>({
      id: 'temperature-contours',
      data: lines,
      getPath: (d) => d.coordinates,
      getColor: [220, 60, 60, 180],
      getWidth: 1.5,
      widthUnits: 'pixels',
      widthMinPixels: 1,
      pickable: false,
    }),
    new TextLayer<ContourLabel>({
      id: 'temperature-labels',
      data: labels,
      getPosition: (d) => d.position,
      getText: (d) => d.text,
      getSize: 13,
      getColor: [180, 40, 40, 220],
      getTextAnchor: 'middle',
      getAlignmentBaseline: 'center',
      fontFamily: 'monospace',
      fontWeight: 'bold',
      background: true,
      getBackgroundColor: [255, 255, 255, 200],
      backgroundPadding: [3, 2, 3, 2],
      sizeUnits: 'pixels',
      pickable: false,
    }),
  ];
}

/**
 * Create geopotential height contour layers with H/L extrema labels.
 * Level-adaptive intervals: 60m above FL240 (< 400 hPa), 30m at/below FL240 (>= 400 hPa).
 */
export function createHeightLayers(data: GriddedData, levelHpa: number): Layer[] {
  const interval = levelHpa < 400 ? 60 : 30;

  const { lines, labels } = computeContourLines(
    data.ni, data.nj, data.lats, data.lons, data.values,
    {
      formatLabel: (v) => `${v}m`,
      interval,
      upsampleFactor: 4,
      splitOnLonWrap: true,
    },
  );

  const layers: Layer[] = [];

  if (lines.length > 0) {
    layers.push(
      new PathLayer<ContourLine>({
        id: 'height-contours',
        data: lines,
        getPath: (d) => d.coordinates,
        getColor: [40, 80, 200, 180],
        getWidth: 1.5,
        widthUnits: 'pixels',
        widthMinPixels: 1,
        pickable: false,
      }),
      new TextLayer<ContourLabel>({
        id: 'height-labels',
        data: labels,
        getPosition: (d) => d.position,
        getText: (d) => d.text,
        getSize: 13,
        getColor: [30, 60, 170, 220],
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'center',
        fontFamily: 'monospace',
        fontWeight: 'bold',
        background: true,
        getBackgroundColor: [255, 255, 255, 200],
        backgroundPadding: [3, 2, 3, 2],
        sizeUnits: 'pixels',
        pickable: false,
      }),
    );
  }

  // H/L extrema detection
  const { highs, lows } = findExtrema(
    data.ni, data.nj, data.lats, data.lons, data.values,
  );

  const extremaData = [
    ...highs.map((e) => ({ ...e, type: 'H' as const })),
    ...lows.map((e) => ({ ...e, type: 'L' as const })),
  ];

  if (extremaData.length > 0) {
    layers.push(
      new TextLayer<typeof extremaData[number]>({
        id: 'height-extrema',
        data: extremaData,
        getPosition: (d) => d.position,
        getText: (d) => `${d.type}\n${Math.round(d.value)}m`,
        getSize: 16,
        getColor: (d) => d.type === 'H' ? [220, 40, 40, 255] : [40, 40, 220, 255],
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'center',
        fontFamily: 'sans-serif',
        fontWeight: 'bold',
        background: true,
        getBackgroundColor: [255, 255, 255, 220],
        backgroundPadding: [4, 3, 4, 3],
        sizeUnits: 'pixels',
        pickable: false,
      }),
    );
  }

  return layers;
}
