import { generateWindBarbSVG, generateWindBarbMapping } from './windBarbs';
import type { WindBarbMapping } from './windBarbs';

const ICON_SIZE = 64;
const TOTAL_ICONS = 41; // calm + 5,10,...,200
const COLS = 10;
const ROWS = Math.ceil(TOTAL_ICONS / COLS);

// No caching during debug — always regenerate
// let cachedAtlas: HTMLCanvasElement | null = null;
// let cachedMapping: WindBarbMapping | null = null;

/**
 * Generate the wind barb sprite atlas as a canvas and icon mapping.
 * Results are cached — subsequent calls return the same objects.
 */
export async function getWindBarbAtlas(): Promise<{
  atlas: HTMLCanvasElement;
  mapping: WindBarbMapping;
}> {
  console.log('[windBarbAtlas] getWindBarbAtlas called');

  const canvas = document.createElement('canvas');
  canvas.width = COLS * ICON_SIZE;
  canvas.height = ROWS * ICON_SIZE;
  const ctx = canvas.getContext('2d')!;

  // Generate and render each SVG to the atlas
  const speeds = [0, ...Array.from({ length: 40 }, (_, i) => (i + 1) * 5)];

  let loadedCount = 0;
  let errorCount = 0;

  // Debug: log first SVG
  console.log('[windBarbAtlas] Sample SVG (10kt):', generateWindBarbSVG(10));

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
        loadedCount++;
        resolve();
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        errorCount++;
        console.warn(`[windBarbAtlas] Failed to load SVG for speed ${speed}`);
        resolve();
      };
      img.src = url;
    });
  });

  await Promise.all(loadPromises);
  console.log(`[windBarbAtlas] Atlas generated: ${loadedCount} loaded, ${errorCount} errors, canvas ${canvas.width}x${canvas.height}`);

  cachedAtlas = canvas;
  cachedMapping = generateWindBarbMapping();

  return { atlas: cachedAtlas, mapping: cachedMapping };
}
