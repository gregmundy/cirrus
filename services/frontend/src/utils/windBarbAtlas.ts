/**
 * Wind barb sprite atlas generation using official WMO/ICAO SVG symbols.
 *
 * Wind arrows sourced from OGCMetOceanDWG/WorldWeatherSymbols (CC BY 4.0)
 * per WMO-No.49 Technical Regulations. NH symbols used for main display.
 *
 * The green jet stream atlas still uses programmatic SVGs since we need
 * color control (WMO SVGs are black).
 */

import { generateWindBarbSVG, generateWindBarbMapping, generateStationBarbMapping } from './windBarbs';
import type { WindBarbMapping } from './windBarbs';

// Import WMO wind arrow SVGs — calm + NH 01-50
import calmSvg from '../assets/wmo-wind-arrows/calm.svg';

// Dynamically build import map for NH wind arrows
const wmoWindImports: Record<number, string> = {};

// We use Vite's import.meta.glob for bulk SVG imports
const nhModules = import.meta.glob('../assets/wmo-wind-arrows/nh_*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

// Parse the file number from path and map to speed
for (const [path, url] of Object.entries(nhModules)) {
  const match = path.match(/nh_(\d+)\.svg$/);
  if (match) {
    const num = parseInt(match[1], 10); // 01=5kt, 02=10kt, ...
    const speedKt = num * 5;
    wmoWindImports[speedKt] = url;
  }
}

const ICON_SIZE = 64;
const COLS = 10;

/** Load an image from a URL. */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

/** Build a wind barb atlas canvas from an array of SVG URLs. */
async function buildAtlas(
  svgUrls: (string | null)[],
): Promise<string> {
  const ROWS = Math.ceil(svgUrls.length / COLS);
  const canvas = document.createElement('canvas');
  canvas.width = COLS * ICON_SIZE;
  canvas.height = ROWS * ICON_SIZE;
  const ctx = canvas.getContext('2d')!;

  for (let i = 0; i < svgUrls.length; i++) {
    const url = svgUrls[i];
    if (!url) continue;
    try {
      const img = await loadImage(url);
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      ctx.drawImage(img, col * ICON_SIZE, row * ICON_SIZE, ICON_SIZE, ICON_SIZE);
    } catch {
      // skip
    }
  }

  return canvas.toDataURL('image/png');
}

let cachedResult: { atlas: string; mapping: WindBarbMapping } | null = null;

/**
 * Generate the wind barb sprite atlas using official WMO NH wind arrows.
 * Layout: index 0 = calm, then 5kt, 10kt, ..., 200kt (41 icons).
 */
export async function getWindBarbAtlas(): Promise<{
  atlas: string;
  mapping: WindBarbMapping;
}> {
  if (cachedResult) return cachedResult;

  // Build ordered URL array: [calm, 5kt, 10kt, ..., 200kt]
  const urls: (string | null)[] = [calmSvg];
  for (let speed = 5; speed <= 200; speed += 5) {
    urls.push(wmoWindImports[speed] ?? null);
  }

  cachedResult = {
    atlas: await buildAtlas(urls),
    mapping: generateWindBarbMapping(),
  };

  return cachedResult;
}

let cachedStationResult: { atlas: string; mapping: WindBarbMapping } | null = null;

/**
 * Station model wind barb atlas — same WMO symbols, different anchor point.
 */
export async function getStationWindBarbAtlas(): Promise<{
  atlas: string;
  mapping: WindBarbMapping;
}> {
  if (cachedStationResult) return cachedStationResult;

  const urls: (string | null)[] = [calmSvg];
  for (let speed = 5; speed <= 200; speed += 5) {
    urls.push(wmoWindImports[speed] ?? null);
  }

  cachedStationResult = {
    atlas: await buildAtlas(urls),
    mapping: generateStationBarbMapping(),
  };

  return cachedStationResult;
}

let cachedJetResult: { atlas: string; mapping: WindBarbMapping } | null = null;

/**
 * Jet stream wind barb atlas — green colored, uses programmatic SVGs
 * since WMO symbols are black and we need color control.
 */
export async function getJetWindBarbAtlas(): Promise<{
  atlas: string;
  mapping: WindBarbMapping;
}> {
  if (cachedJetResult) return cachedJetResult;

  const speeds = [0, ...Array.from({ length: 40 }, (_, i) => (i + 1) * 5)];
  const urls: string[] = [];

  for (const speed of speeds) {
    const svg = generateWindBarbSVG(speed, false, '#1a6b3a', 2.5);
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    urls.push(URL.createObjectURL(blob));
  }

  const atlas = await buildAtlas(urls);

  // Clean up blob URLs
  for (const url of urls) URL.revokeObjectURL(url);

  cachedJetResult = {
    atlas,
    mapping: generateWindBarbMapping(),
  };

  return cachedJetResult;
}
