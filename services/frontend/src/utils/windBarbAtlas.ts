import { generateWindBarbSVG, generateWindBarbMapping } from './windBarbs';
import type { WindBarbMapping } from './windBarbs';

const ICON_SIZE = 64;
const TOTAL_ICONS = 41; // calm + 5,10,...,200
const COLS = 10;
const ROWS = Math.ceil(TOTAL_ICONS / COLS);

let cachedAtlasUrl: string | null = null;
let cachedMapping: WindBarbMapping | null = null;

/**
 * Generate the wind barb sprite atlas as a data URL and icon mapping.
 * Results are cached — subsequent calls return the same objects.
 */
export async function getWindBarbAtlas(): Promise<{
  atlas: string;
  mapping: WindBarbMapping;
}> {
  if (cachedAtlasUrl && cachedMapping) {
    return { atlas: cachedAtlasUrl, mapping: cachedMapping };
  }

  const canvas = document.createElement('canvas');
  canvas.width = COLS * ICON_SIZE;
  canvas.height = ROWS * ICON_SIZE;
  const ctx = canvas.getContext('2d')!;

  // Generate and render each SVG to the atlas
  const speeds = [0, ...Array.from({ length: 40 }, (_, i) => (i + 1) * 5)];

  const loadPromises = speeds.map((speed, index) => {
    const svg = generateWindBarbSVG(speed);
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.width = ICON_SIZE;
    img.height = ICON_SIZE;

    return new Promise<void>((resolve) => {
      img.onload = () => {
        const col = index % COLS;
        const row = Math.floor(index / COLS);
        ctx.drawImage(img, col * ICON_SIZE, row * ICON_SIZE, ICON_SIZE, ICON_SIZE);
        URL.revokeObjectURL(url);
        resolve();
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(); // skip failed icons
      };
      img.src = url;
    });
  });

  await Promise.all(loadPromises);

  cachedAtlasUrl = canvas.toDataURL('image/png');
  cachedMapping = generateWindBarbMapping();

  return { atlas: cachedAtlasUrl, mapping: cachedMapping };
}
