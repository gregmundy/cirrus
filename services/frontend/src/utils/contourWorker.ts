import { computeContourLines } from './contourComputation';
import type { ContourLine, ContourLabel } from './contourComputation';
import { findExtrema } from './extremaDetection';
import type { Extremum } from './extremaDetection';

export interface ContourRequest {
  id: number;
  type: 'temperature' | 'height' | 'humidity' | 'tropopause' | 'maxwind';
  ni: number;
  nj: number;
  lats: number[];
  lons: number[];
  values: number[];
  interval: number;
  upsampleFactor: number;
  /** Suffix appended to contour value for labels (e.g. "°C", "%", "m") */
  labelSuffix: string;
  // Height-specific
  influenceRadius?: number;
  minSeparationDeg?: number;
}

export interface ContourResult {
  id: number;
  type: 'temperature' | 'height' | 'humidity' | 'tropopause' | 'maxwind';
  lines: ContourLine[];
  labels: ContourLabel[];
  extrema?: { highs: Extremum[]; lows: Extremum[] };
}

self.onmessage = (e: MessageEvent<ContourRequest>) => {
  const req = e.data;
  const suffix = req.labelSuffix;

  const { lines, labels } = computeContourLines(
    req.ni, req.nj, req.lats, req.lons, req.values,
    {
      formatLabel: (v: number) => `${v}${suffix}`,
      interval: req.interval,
      upsampleFactor: req.upsampleFactor,
      splitOnLonWrap: true,
    },
  );

  const result: ContourResult = { id: req.id, type: req.type, lines, labels };

  if (req.type === 'height') {
    result.extrema = findExtrema(
      req.ni, req.nj, req.lats, req.lons, req.values,
      req.influenceRadius ?? 30,
      req.minSeparationDeg ?? 25,
    );
  }

  self.postMessage(result);
};
