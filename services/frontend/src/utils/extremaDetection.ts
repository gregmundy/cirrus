/**
 * Detect local maxima (H) and minima (L) in a gridded field.
 * Used for labeling geopotential height centers on the map.
 */

export interface Extremum {
  position: [number, number]; // [lon, lat]
  value: number;
}

/**
 * Find high and low pressure centers in a 2D grid.
 *
 * Algorithm:
 * 1. For each grid point (skipping edges), check if it's the max or min
 *    within a square neighborhood of `influenceRadius` grid points.
 * 2. Deduplicate: sort candidates by strength and suppress any within
 *    `minSeparationDeg` degrees of a stronger candidate of the same type.
 */
export function findExtrema(
  ni: number,
  nj: number,
  lats: number[],
  lons: number[],
  values: number[],
  influenceRadius: number = 10,
  minSeparationDeg: number = 15,
): { highs: Extremum[]; lows: Extremum[] } {
  const margin = 2;
  const candidateHighs: Extremum[] = [];
  const candidateLows: Extremum[] = [];

  for (let j = margin; j < nj - margin; j++) {
    for (let i = margin; i < ni - margin; i++) {
      const val = values[j * ni + i];
      let isMax = true;
      let isMin = true;

      // Check neighborhood
      const jMin = Math.max(0, j - influenceRadius);
      const jMax = Math.min(nj - 1, j + influenceRadius);
      const iMin = Math.max(0, i - influenceRadius);
      const iMax = Math.min(ni - 1, i + influenceRadius);

      for (let jj = jMin; jj <= jMax && (isMax || isMin); jj++) {
        for (let ii = iMin; ii <= iMax && (isMax || isMin); ii++) {
          if (jj === j && ii === i) continue;
          const neighbor = values[jj * ni + ii];
          if (neighbor >= val) isMax = false;
          if (neighbor <= val) isMin = false;
        }
      }

      if (isMax) {
        candidateHighs.push({ position: [lons[i], lats[j]], value: val });
      }
      if (isMin) {
        candidateLows.push({ position: [lons[i], lats[j]], value: val });
      }
    }
  }

  // Deduplicate: keep strongest, suppress nearby weaker candidates
  const highs = deduplicateExtrema(candidateHighs, minSeparationDeg, 'high');
  const lows = deduplicateExtrema(candidateLows, minSeparationDeg, 'low');

  return { highs, lows };
}

function deduplicateExtrema(
  candidates: Extremum[],
  minSeparationDeg: number,
  type: 'high' | 'low',
): Extremum[] {
  // Sort by strength: highest first for highs, lowest first for lows
  const sorted = [...candidates].sort((a, b) =>
    type === 'high' ? b.value - a.value : a.value - b.value
  );

  const kept: Extremum[] = [];
  for (const candidate of sorted) {
    const tooClose = kept.some(
      (k) =>
        Math.abs(candidate.position[0] - k.position[0]) < minSeparationDeg &&
        Math.abs(candidate.position[1] - k.position[1]) < minSeparationDeg
    );
    if (!tooClose) {
      kept.push(candidate);
    }
  }

  return kept;
}
