import { BitmapLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';

export interface SatelliteData {
  channel: number;
  channel_name: string;
  units: string;
  timestamp: string;
  ni: number;
  nj: number;
  lat_first: number;
  lon_first: number;
  d_lat: number;
  d_lon: number;
  value_min: number;
  value_max: number;
  values: number[];
}

/** Color ramp: array of [r, g, b] stops from low to high value. */
type ColorRamp = [number, number, number][];

// IR: cold (white/bright) to warm (dark) — inverted greyscale
const IR_RAMP: ColorRamp = [
  [255, 255, 255],  // coldest (high clouds)
  [200, 200, 200],
  [150, 150, 150],
  [100, 100, 100],
  [50, 50, 50],
  [20, 20, 20],     // warmest (surface)
];

// Visible: dark (clear) to bright (cloud)
const VIS_RAMP: ColorRamp = [
  [10, 10, 15],     // no reflectance (dark)
  [40, 40, 50],
  [100, 100, 110],
  [160, 160, 170],
  [210, 210, 215],
  [250, 250, 255],  // full reflectance (bright cloud)
];

// Water vapor: dry (brown/orange) to moist (green/blue)
const WV_RAMP: ColorRamp = [
  [80, 30, 10],     // very dry (warm BT)
  [180, 100, 30],
  [220, 180, 50],
  [100, 200, 80],
  [40, 150, 180],
  [20, 60, 140],    // very moist (cold BT)
];

function getRamp(channel: number): ColorRamp {
  if (channel === 2) return VIS_RAMP;
  if (channel === 8) return WV_RAMP;
  return IR_RAMP;  // Ch 13 and others
}

/** Apply color ramp to a normalized value [0, 1]. */
function applyRamp(ramp: ColorRamp, t: number): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, t));
  const idx = clamped * (ramp.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.min(lo + 1, ramp.length - 1);
  const frac = idx - lo;

  return [
    Math.round(ramp[lo][0] + (ramp[hi][0] - ramp[lo][0]) * frac),
    Math.round(ramp[lo][1] + (ramp[hi][1] - ramp[lo][1]) * frac),
    Math.round(ramp[lo][2] + (ramp[hi][2] - ramp[lo][2]) * frac),
  ];
}

/**
 * Create a satellite imagery bitmap layer from processed GOES data.
 * Converts float values to RGBA pixels using a channel-appropriate color ramp,
 * then renders as a BitmapLayer.
 */
export function createSatelliteLayer(data: SatelliteData, opacity: number = 0.7): Layer | null {
  const { ni, nj, values, value_min, value_max, channel, lat_first, lon_first, d_lat, d_lon } = data;

  if (values.length !== ni * nj) return null;

  const ramp = getRamp(channel);
  const range = value_max - value_min || 1;

  // Build RGBA pixel array
  const pixels = new Uint8ClampedArray(ni * nj * 4);
  for (let j = 0; j < nj; j++) {
    for (let i = 0; i < ni; i++) {
      const srcIdx = j * ni + i;
      const dstIdx = srcIdx * 4;
      const val = values[srcIdx];

      if (val <= -999 || isNaN(val)) {
        // Transparent for no-data / outside coverage
        pixels[dstIdx] = 0;
        pixels[dstIdx + 1] = 0;
        pixels[dstIdx + 2] = 0;
        pixels[dstIdx + 3] = 0;
      } else {
        const t = (val - value_min) / range;
        const [r, g, b] = applyRamp(ramp, t);
        pixels[dstIdx] = r;
        pixels[dstIdx + 1] = g;
        pixels[dstIdx + 2] = b;
        pixels[dstIdx + 3] = 255;
      }
    }
  }

  // Create ImageData and convert to data URL via canvas
  const canvas = document.createElement('canvas');
  canvas.width = ni;
  canvas.height = nj;
  const ctx = canvas.getContext('2d')!;
  const imageData = new ImageData(pixels, ni, nj);
  ctx.putImageData(imageData, 0, 0);
  const dataUrl = canvas.toDataURL('image/png');

  // Compute geographic bounds
  const north = lat_first;
  const south = lat_first + d_lat * (nj - 1);
  const west = lon_first;
  const east = lon_first + d_lon * (ni - 1);

  return new BitmapLayer({
    id: `satellite-ch${channel}`,
    image: dataUrl,
    bounds: [west, south, east, north],
    opacity,
    pickable: false,
  });
}
