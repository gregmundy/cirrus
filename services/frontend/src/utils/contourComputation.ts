import { contours } from 'd3-contour';

export interface ContourLine {
  coordinates: [number, number][];
  value: number;
}

export interface ContourLabel {
  position: [number, number];
  text: string;
}

export interface ComputeContourOptions {
  convertValue?: (v: number) => number;
  formatLabel?: (value: number) => string;
  interval: number;
  upsampleFactor?: number;
  splitOnLonWrap?: boolean;
  /** Gaussian smoothing radius in grid cells (0 = no smoothing). */
  smoothingRadius?: number;
}

/**
 * Upsample a 2D grid using bilinear interpolation.
 * Produces a grid `factor` times larger in each dimension.
 */
function bilinearUpsample(
  values: number[] | Float32Array,
  ni: number,
  nj: number,
  factor: number,
): { values: number[]; ni: number; nj: number } {
  const newNi = (ni - 1) * factor + 1;
  const newNj = (nj - 1) * factor + 1;
  const result = new Float64Array(newNi * newNj);

  for (let jj = 0; jj < newNj; jj++) {
    const srcJ = jj / factor;
    const j0 = Math.min(Math.floor(srcJ), nj - 2);
    const j1 = j0 + 1;
    const jf = srcJ - j0;

    for (let ii = 0; ii < newNi; ii++) {
      const srcI = ii / factor;
      const i0 = Math.min(Math.floor(srcI), ni - 2);
      const i1 = i0 + 1;
      const iF = srcI - i0;

      const v00 = values[j0 * ni + i0];
      const v10 = values[j0 * ni + i1];
      const v01 = values[j1 * ni + i0];
      const v11 = values[j1 * ni + i1];

      result[jj * newNi + ii] =
        v00 * (1 - iF) * (1 - jf) +
        v10 * iF * (1 - jf) +
        v01 * (1 - iF) * jf +
        v11 * iF * jf;
    }
  }

  return { values: Array.from(result), ni: newNi, nj: newNj };
}

/**
 * Linearly interpolate an array to a new size.
 */
function interpolateArray(arr: number[], newLen: number): number[] {
  const result = new Array(newLen);
  for (let i = 0; i < newLen; i++) {
    const src = (i / (newLen - 1)) * (arr.length - 1);
    const i0 = Math.min(Math.floor(src), arr.length - 2);
    const f = src - i0;
    result[i] = arr[i0] * (1 - f) + arr[i0 + 1] * f;
  }
  return result;
}

/**
 * Apply Gaussian smoothing to a 2D grid.
 * Uses separable 1D passes for efficiency.
 */
function gaussianSmooth(
  values: number[] | Float32Array,
  ni: number,
  nj: number,
  radius: number,
): number[] {
  if (radius <= 0) return Array.from(values);

  // Build 1D Gaussian kernel
  const kernelSize = Math.ceil(radius * 3) * 2 + 1;
  const half = (kernelSize - 1) / 2;
  const kernel = new Float64Array(kernelSize);
  let sum = 0;
  for (let i = 0; i < kernelSize; i++) {
    const x = i - half;
    kernel[i] = Math.exp(-0.5 * (x / radius) * (x / radius));
    sum += kernel[i];
  }
  for (let i = 0; i < kernelSize; i++) kernel[i] /= sum;

  // Horizontal pass
  const horiz = new Float64Array(ni * nj);
  for (let j = 0; j < nj; j++) {
    for (let i = 0; i < ni; i++) {
      let acc = 0;
      let wt = 0;
      for (let k = 0; k < kernelSize; k++) {
        const ii = Math.min(Math.max(i + k - half, 0), ni - 1);
        acc += values[j * ni + ii] * kernel[k];
        wt += kernel[k];
      }
      horiz[j * ni + i] = acc / wt;
    }
  }

  // Vertical pass
  const result = new Array(ni * nj);
  for (let j = 0; j < nj; j++) {
    for (let i = 0; i < ni; i++) {
      let acc = 0;
      let wt = 0;
      for (let k = 0; k < kernelSize; k++) {
        const jj = Math.min(Math.max(j + k - half, 0), nj - 1);
        acc += horiz[jj * ni + i] * kernel[k];
        wt += kernel[k];
      }
      result[j * ni + i] = acc / wt;
    }
  }

  return result;
}

/**
 * Compute contour lines and labels from raw gridded data using d3-contour
 * (marching squares). This is a pure computation function with no rendering
 * dependencies.
 *
 * Upsamples the grid with bilinear interpolation for smooth curves, then
 * converts d3 grid-space coordinates to [lon, lat], splitting segments at
 * grid boundaries and optionally at longitude-wrap seams.
 */
export function computeContourLines(
  ni: number,
  nj: number,
  lats: number[],
  lons: number[],
  rawValues: number[] | Float32Array,
  options: ComputeContourOptions,
): { lines: ContourLine[]; labels: ContourLabel[] } {
  if (rawValues.length === 0) return { lines: [], labels: [] };

  const {
    convertValue,
    formatLabel = (v) => `${v}`,
    interval,
    upsampleFactor = 4,
    splitOnLonWrap = true,
    smoothingRadius = 2,
  } = options;

  // Optionally convert values
  let converted: number[] | Float32Array;
  if (convertValue) {
    const arr = new Array(rawValues.length);
    for (let i = 0; i < rawValues.length; i++) {
      arr[i] = convertValue(rawValues[i]);
    }
    converted = arr;
  } else {
    converted = rawValues;
  }

  // Apply Gaussian smoothing before upsampling (suppresses grid-scale noise)
  const smoothed = smoothingRadius > 0
    ? gaussianSmooth(converted, ni, nj, smoothingRadius)
    : converted;

  // Upsample the grid for smoother contours
  const up = bilinearUpsample(smoothed, ni, nj, upsampleFactor);
  const upNi = up.ni;
  const upNj = up.nj;
  const upLats = interpolateArray(lats, upNj);
  const upLons = interpolateArray(lons, upNi);

  // Determine contour thresholds at interval spacing
  // Avoid spread operator on large arrays (stack overflow risk)
  let minVal = Infinity;
  let maxVal = -Infinity;
  for (const v of up.values) {
    if (v < minVal) minVal = v;
    if (v > maxVal) maxVal = v;
  }
  const minT = Math.floor(minVal / interval) * interval;
  const maxT = Math.ceil(maxVal / interval) * interval;
  const thresholds: number[] = [];
  for (let t = minT; t <= maxT; t += interval) {
    thresholds.push(t);
  }

  // Run d3 marching squares on the upsampled grid
  const contourGenerator = contours().size([upNi, upNj]).thresholds(thresholds);
  const contourFeatures = contourGenerator(up.values);

  // Check if a grid-space point lies on the boundary of the data grid.
  // d3-contour closes polygons along grid edges, producing straight
  // horizontal/vertical artifacts that are not real isolines.
  const EPS = 0.01;
  function isOnBoundary(gx: number, gy: number): boolean {
    return gx <= EPS || gx >= upNi - 1 - EPS || gy <= EPS || gy >= upNj - 1 - EPS;
  }

  // Convert a grid-index point to [lon, lat]
  function gridToLonLat(gx: number, gy: number): [number, number] {
    const xi = Math.min(Math.floor(gx), upNi - 2);
    const yi = Math.min(Math.floor(gy), upNj - 2);
    const xf = gx - xi;
    const yf = gy - yi;

    const lon = upLons[xi] + xf * (upLons[Math.min(xi + 1, upNi - 1)] - upLons[xi]);
    const lat = upLats[yi] + yf * (upLats[Math.min(yi + 1, upNj - 1)] - upLats[yi]);

    return [lon, lat];
  }

  // Convert d3 contour coordinates (grid indices) to lat/lon,
  // splitting rings at boundary segments to remove edge artifacts.
  const lines: ContourLine[] = [];
  const labels: ContourLabel[] = [];

  for (const feature of contourFeatures) {
    const value = feature.value;

    for (const polygon of feature.coordinates) {
      for (const ring of polygon) {
        // Split the ring into segments, removing boundary points and
        // optionally longitude-wrap artifacts (large lon jumps from the 0/360 seam)
        let currentSegment: [number, number][] = [];

        const flushSegment = () => {
          if (currentSegment.length >= 2) {
            lines.push({ coordinates: currentSegment, value });
            const mid = currentSegment[Math.floor(currentSegment.length / 2)];
            labels.push({ position: mid, text: formatLabel(value) });
          }
          currentSegment = [];
        };

        for (const [gx, gy] of ring) {
          if (isOnBoundary(gx, gy)) {
            flushSegment();
          } else {
            const pt = gridToLonLat(gx, gy);
            // Detect longitude wrap: if consecutive points jump > 90, split
            if (splitOnLonWrap && currentSegment.length > 0) {
              const prev = currentSegment[currentSegment.length - 1];
              if (Math.abs(pt[0] - prev[0]) > 90) {
                flushSegment();
              }
            }
            currentSegment.push(pt);
          }
        }

        flushSegment();
      }
    }
  }

  // Subsample labels -- distance-based spacing to allow multiple per value
  const labelMap = new Map<number, [number, number][]>();
  const filteredLabels = labels.filter((l) => {
    const v = parseFloat(l.text);
    const existing = labelMap.get(v);
    if (existing) {
      const tooClose = existing.some(
        ([lon, lat]) =>
          Math.abs(l.position[0] - lon) < 40 && Math.abs(l.position[1] - lat) < 20
      );
      if (tooClose) return false;
      existing.push(l.position);
    } else {
      labelMap.set(v, [l.position]);
    }
    return true;
  });

  return { lines, labels: filteredLabels };
}
