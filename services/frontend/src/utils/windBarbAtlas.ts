import { generateWindBarbSVG, generateWindBarbMapping } from './windBarbs';
import type { WindBarbMapping } from './windBarbs';

const ICON_SIZE = 64;
const COLS = 10;

let cachedResult: { atlas: string; mapping: WindBarbMapping } | null = null;

/**
 * Generate the wind barb sprite atlas as a data URL and icon mapping.
 * Renders all 41 SVG barb icons (calm + 5-200kt in 5kt steps) into a
 * canvas, converts to PNG data URL for Deck.gl IconLayer.
 * Results are cached after first call.
 */
export async function getWindBarbAtlas(): Promise<{
  atlas: string;
  mapping: WindBarbMapping;
}> {
  if (cachedResult) return cachedResult;

  const speeds = [0, ...Array.from({ length: 40 }, (_, i) => (i + 1) * 5)];
  const ROWS = Math.ceil(speeds.length / COLS);

  const canvas = document.createElement('canvas');
  canvas.width = COLS * ICON_SIZE;
  canvas.height = ROWS * ICON_SIZE;
  const ctx = canvas.getContext('2d')!;

  for (let index = 0; index < speeds.length; index++) {
    const svg = generateWindBarbSVG(speeds[index]);
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = url;
      });
      const col = index % COLS;
      const row = Math.floor(index / COLS);
      ctx.drawImage(img, col * ICON_SIZE, row * ICON_SIZE, ICON_SIZE, ICON_SIZE);
    } catch {
      // skip failed icons
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  cachedResult = {
    atlas: canvas.toDataURL('image/png'),
    mapping: generateWindBarbMapping(),
  };

  return cachedResult;
}
