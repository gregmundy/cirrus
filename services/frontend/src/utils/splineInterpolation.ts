/**
 * Cubic spline interpolation and scalloped boundary generation
 * for SIGWX IWXXM rendering.
 */

/**
 * Natural cubic spline interpolation.
 * Takes control points and returns a densified smooth curve.
 *
 * @param points Control points as [lon, lat] pairs
 * @param segments Number of interpolated points between each control point pair
 * @returns Densified smooth coordinates
 */
export function interpolateSpline(
  points: [number, number][],
  segments: number = 10,
): [number, number][] {
  if (points.length < 3) return points;

  const lons = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);

  const interpLons = cubicSpline1D(lons, segments);
  const interpLats = cubicSpline1D(lats, segments);

  const result: [number, number][] = [];
  for (let i = 0; i < interpLons.length; i++) {
    result.push([interpLons[i], interpLats[i]]);
  }
  return result;
}

/**
 * 1D natural cubic spline interpolation.
 * Solves the tridiagonal system for second derivatives,
 * then evaluates the piecewise cubic between each pair of knots.
 */
function cubicSpline1D(y: number[], segments: number): number[] {
  const n = y.length;
  if (n < 3) return y;

  // Compute intervals (uniform parameterization t = 0, 1, 2, ...)
  const h = 1; // uniform spacing

  // Solve tridiagonal system for second derivatives (M)
  // Natural spline: M[0] = M[n-1] = 0
  const M = new Array(n).fill(0);
  const alpha = new Array(n).fill(0);
  const l = new Array(n).fill(1);
  const mu = new Array(n).fill(0);
  const z = new Array(n).fill(0);

  for (let i = 1; i < n - 1; i++) {
    alpha[i] = (3 / h) * (y[i + 1] - y[i]) - (3 / h) * (y[i] - y[i - 1]);
  }

  for (let i = 1; i < n - 1; i++) {
    l[i] = 4 * h - h * mu[i - 1];
    mu[i] = h / l[i];
    z[i] = (alpha[i] - h * z[i - 1]) / l[i];
  }

  for (let j = n - 2; j >= 1; j--) {
    M[j] = z[j] - mu[j] * M[j + 1];
  }

  // Evaluate spline at dense points
  const result: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = y[i];
    const b = (y[i + 1] - y[i]) / h - (h / 3) * (2 * M[i] + M[i + 1]);
    const c = M[i];
    const d = (M[i + 1] - M[i]) / (3 * h);

    const numPts = i === n - 2 ? segments + 1 : segments;
    for (let j = 0; j < numPts; j++) {
      const t = (j / segments) * h;
      result.push(a + b * t + c * t * t + d * t * t * t);
    }
  }

  return result;
}

/**
 * Generate a scalloped (semicircular bumps) version of a polygon ring.
 * Used for CB (cumulonimbus) boundary rendering per ICAO SIGWX symbology.
 *
 * @param ring Polygon ring as [lon, lat] pairs (closed — first === last)
 * @param scallopSize Approximate radius of each scallop in degrees
 * @param pointsPerScallop Number of points to generate per semicircular arc
 * @returns New ring with scalloped edges
 */
export function generateScallopedRing(
  ring: [number, number][],
  scallopSize: number = 1.5,
  pointsPerScallop: number = 8,
): [number, number][] {
  if (ring.length < 4) return ring; // Need at least a triangle + closing point

  const result: [number, number][] = [];
  // Skip the last point (closing point) during iteration
  const n = ring.length - 1;

  for (let i = 0; i < n; i++) {
    const p1 = ring[i];
    const p2 = ring[(i + 1) % n];

    const dx = p2[0] - p1[0];
    const dy = p2[1] - p1[1];
    const edgeLen = Math.sqrt(dx * dx + dy * dy);

    if (edgeLen < 0.01) {
      result.push(p1);
      continue;
    }

    // Number of scallops along this edge
    const numScallops = Math.max(1, Math.round(edgeLen / (scallopSize * 2)));
    const segLen = edgeLen / numScallops;

    // Unit vectors: along edge and normal (pointing outward)
    const ux = dx / edgeLen;
    const uy = dy / edgeLen;
    // Normal pointing outward (right-hand rule for clockwise rings)
    const nx = -uy;
    const ny = ux;

    for (let s = 0; s < numScallops; s++) {
      const t0 = s / numScallops;
      const t1 = (s + 1) / numScallops;
      const cx = p1[0] + (t0 + t1) / 2 * dx; // center of this scallop segment
      const cy = p1[1] + (t0 + t1) / 2 * dy;
      const radius = segLen / 2;

      // Generate semicircular arc from segment start to segment end
      for (let j = 0; j <= pointsPerScallop; j++) {
        const angle = Math.PI * (j / pointsPerScallop); // 0 to PI
        const along = -Math.cos(angle) * radius; // -radius to +radius along edge
        const perp = Math.sin(angle) * radius; // 0 to radius perpendicular (outward)

        result.push([
          cx + along * ux + perp * nx,
          cy + along * uy + perp * ny,
        ]);
      }
    }
  }

  // Close the ring
  if (result.length > 0) {
    result.push(result[0]);
  }

  return result;
}
