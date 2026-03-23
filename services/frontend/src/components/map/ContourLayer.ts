import { PathLayer, TextLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import { PathStyleExtension } from '@deck.gl/extensions';
import type { ContourLine, ContourLabel } from '../../utils/contourComputation';
import type { Extremum } from '../../utils/extremaDetection';

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

export interface ComputedContours {
  lines: ContourLine[];
  labels: ContourLabel[];
  extrema?: { highs: Extremum[]; lows: Extremum[] };
}

/**
 * Create temperature isotherm layers from pre-computed contours.
 */
export function createTemperatureLayers(contours: ComputedContours): Layer[] {
  const { lines, labels } = contours;
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
      getSize: 12,
      getColor: [200, 50, 50, 255],
      getTextAnchor: 'middle',
      getAlignmentBaseline: 'center',
      fontFamily: 'monospace',
      fontWeight: 'bold',
      sizeUnits: 'pixels',
      pickable: false,
    }),
  ];
}

/**
 * Create relative humidity contour layers from pre-computed contours.
 */
export function createHumidityLayers(contours: ComputedContours): Layer[] {
  const { lines, labels } = contours;
  if (lines.length === 0) return [];

  return [
    new PathLayer<ContourLine>({
      id: 'humidity-contours',
      data: lines,
      getPath: (d) => d.coordinates,
      getColor: [30, 160, 60, 180],
      getWidth: 1.5,
      widthUnits: 'pixels',
      widthMinPixels: 1,
      pickable: false,
    }),
    new TextLayer<ContourLabel>({
      id: 'humidity-labels',
      data: labels,
      getPosition: (d) => d.position,
      getText: (d) => d.text,
      getSize: 12,
      getColor: [20, 140, 50, 255],
      getTextAnchor: 'middle',
      getAlignmentBaseline: 'center',
      fontFamily: 'monospace',
      fontWeight: 'bold',
      sizeUnits: 'pixels',
      pickable: false,
    }),
  ];
}

/**
 * Create geopotential height contour layers from pre-computed contours.
 */
export function createHeightLayers(contours: ComputedContours): Layer[] {
  const { lines, labels, extrema } = contours;
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
        getSize: 12,
        getColor: [30, 60, 180, 255],
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'center',
        fontFamily: 'monospace',
        fontWeight: 'bold',
        sizeUnits: 'pixels',
        pickable: false,
      }),
    );
  }

  if (extrema) {
    const extremaData = [
      ...extrema.highs.map((e) => ({ ...e, type: 'H' as const })),
      ...extrema.lows.map((e) => ({ ...e, type: 'L' as const })),
    ];

    if (extremaData.length > 0) {
      layers.push(
        new TextLayer<typeof extremaData[number]>({
          id: 'height-extrema-letter',
          data: extremaData,
          getPosition: (d) => d.position,
          getText: (d) => d.type,
          getSize: 32,
          getColor: (d) => d.type === 'H' ? [220, 30, 30, 255] : [30, 30, 220, 255],
          getTextAnchor: 'middle',
          getAlignmentBaseline: 'center',
          fontFamily: 'sans-serif',
          fontWeight: 'bold',
          sizeUnits: 'pixels',
          pickable: false,
          getPixelOffset: [0, -10],
        }),
        new TextLayer<typeof extremaData[number]>({
          id: 'height-extrema-value',
          data: extremaData,
          getPosition: (d) => d.position,
          getText: (d) => `${Math.round(d.value)}m`,
          getSize: 12,
          getColor: (d) => d.type === 'H' ? [180, 30, 30, 220] : [30, 30, 180, 220],
          getTextAnchor: 'middle',
          getAlignmentBaseline: 'center',
          fontFamily: 'monospace',
          fontWeight: 'bold',
          sizeUnits: 'pixels',
          pickable: false,
          getPixelOffset: [0, 10],
        }),
      );
    }
  }

  return layers;
}

/**
 * Create tropopause height contour layers — thin dotted light blue lines labeled with FL.
 */
export function createTropopauseLayers(contours: ComputedContours): Layer[] {
  const { lines, labels } = contours;
  if (lines.length === 0) return [];

  return [
    new (PathLayer as any)({
      id: 'tropopause-contours',
      data: lines,
      getPath: (d: ContourLine) => d.coordinates,
      getColor: [100, 180, 240, 200],
      getWidth: 1.5,
      widthUnits: 'pixels',
      widthMinPixels: 1,
      getDashArray: [4, 3],
      extensions: [new PathStyleExtension({ dash: true })],
      pickable: false,
    }),
    new TextLayer<ContourLabel>({
      id: 'tropopause-labels',
      data: labels,
      getPosition: (d) => d.position,
      getText: (d) => d.text,
      getSize: 12,
      getColor: [70, 150, 220, 255],
      getTextAnchor: 'middle',
      getAlignmentBaseline: 'center',
      fontFamily: 'monospace',
      fontWeight: 'bold',
      sizeUnits: 'pixels',
      pickable: false,
    }),
  ];
}

/**
 * Create max wind isotach contour layers — dark green lines at 20kt intervals.
 * Lines at 80kt+ are thicker to highlight jet cores.
 */
export function createMaxWindIsotachLayers(contours: ComputedContours): Layer[] {
  const { lines, labels } = contours;
  if (lines.length === 0) return [];

  // Split lines into normal (<80kt) and strong (>=80kt)
  const normalLines = lines.filter((l) => l.value < 80);
  const strongLines = lines.filter((l) => l.value >= 80);

  const layers: Layer[] = [];

  if (normalLines.length > 0) {
    layers.push(
      new PathLayer<ContourLine>({
        id: 'maxwind-isotach-normal',
        data: normalLines,
        getPath: (d) => d.coordinates,
        getColor: [20, 120, 60, 160],
        getWidth: 1.5,
        widthUnits: 'pixels',
        widthMinPixels: 1,
        pickable: false,
      }),
    );
  }

  if (strongLines.length > 0) {
    layers.push(
      new PathLayer<ContourLine>({
        id: 'maxwind-isotach-strong',
        data: strongLines,
        getPath: (d) => d.coordinates,
        getColor: [15, 100, 50, 200],
        getWidth: 2.5,
        widthUnits: 'pixels',
        widthMinPixels: 2,
        pickable: false,
      }),
    );
  }

  if (labels.length > 0) {
    layers.push(
      new TextLayer<ContourLabel>({
        id: 'maxwind-isotach-labels',
        data: labels,
        getPosition: (d) => d.position,
        getText: (d) => d.text,
        getSize: 12,
        getColor: [15, 100, 50, 255],
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'center',
        fontFamily: 'monospace',
        fontWeight: 'bold',
        sizeUnits: 'pixels',
        pickable: false,
      }),
    );
  }

  return layers;
}
