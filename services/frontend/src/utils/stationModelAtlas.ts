/**
 * Generate a sprite atlas for WMO station model cloud cover circles.
 *
 * Standard WMO cloud cover symbols:
 *   CLR/SKC: empty circle ○
 *   FEW:     circle with one vertical line (1/8-2/8)
 *   SCT:     half-filled circle ◑ (3/8-4/8)
 *   BKN:     three-quarter filled ◕ (5/8-7/8)
 *   OVC:     filled circle ● (8/8)
 *   VV:      X inside circle ⊗ (obscured / vertical visibility)
 *   missing: circle with M
 */

const ICON_SIZE = 32;
const RADIUS = 12;
const CENTER = ICON_SIZE / 2;
const STROKE_WIDTH = 2;

type CoverType = 'CLR' | 'FEW' | 'SCT' | 'BKN' | 'OVC' | 'VV' | 'missing';

const COVER_TYPES: CoverType[] = ['CLR', 'FEW', 'SCT', 'BKN', 'OVC', 'VV', 'missing'];

function generateCloudCoverSVG(type: CoverType, ringColor: string): string {
  const r = RADIUS;
  const cx = CENTER;
  const cy = CENTER;
  const sw = STROKE_WIDTH;

  const circle = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${ringColor}" stroke-width="${sw}"/>`;

  switch (type) {
    case 'CLR':
      // Empty circle
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_SIZE}" height="${ICON_SIZE}">${circle}</svg>`;

    case 'FEW':
      // Circle with bottom quarter filled
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_SIZE}" height="${ICON_SIZE}">
        ${circle}
        <path d="M${cx},${cy} L${cx - r * Math.sin(Math.PI / 4)},${cy + r * Math.cos(Math.PI / 4)} A${r},${r} 0 0,0 ${cx + r * Math.sin(Math.PI / 4)},${cy + r * Math.cos(Math.PI / 4)} Z" fill="${ringColor}"/>
      </svg>`;

    case 'SCT':
      // Half-filled circle (right half)
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_SIZE}" height="${ICON_SIZE}">
        ${circle}
        <path d="M${cx},${cy - r} A${r},${r} 0 0,1 ${cx},${cy + r} Z" fill="${ringColor}"/>
      </svg>`;

    case 'BKN':
      // Three-quarter filled (only top-right quarter empty)
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_SIZE}" height="${ICON_SIZE}">
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="${ringColor}" stroke="${ringColor}" stroke-width="${sw}"/>
        <path d="M${cx},${cy} L${cx},${cy - r} A${r},${r} 0 0,1 ${cx + r},${cy} Z" fill="white"/>
      </svg>`;

    case 'OVC':
      // Fully filled circle
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_SIZE}" height="${ICON_SIZE}">
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="${ringColor}" stroke="${ringColor}" stroke-width="${sw}"/>
      </svg>`;

    case 'VV':
      // X inside circle (vertical visibility / obscured)
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_SIZE}" height="${ICON_SIZE}">
        ${circle}
        <line x1="${cx - r * 0.6}" y1="${cy - r * 0.6}" x2="${cx + r * 0.6}" y2="${cy + r * 0.6}" stroke="${ringColor}" stroke-width="${sw}"/>
        <line x1="${cx + r * 0.6}" y1="${cy - r * 0.6}" x2="${cx - r * 0.6}" y2="${cy + r * 0.6}" stroke="${ringColor}" stroke-width="${sw}"/>
      </svg>`;

    case 'missing':
    default:
      // Circle with M
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_SIZE}" height="${ICON_SIZE}">
        ${circle}
        <text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="12" font-family="monospace" fill="${ringColor}">M</text>
      </svg>`;
  }
}

export interface StationModelMapping {
  [key: string]: { x: number; y: number; width: number; height: number };
}

const FLIGHT_CAT_COLORS: Record<string, string> = {
  VFR: '#00c800',
  MVFR: '#0064ff',
  IFR: '#dc0000',
  LIFR: '#c800c8',
};
const DEFAULT_FC_COLOR = '#999999';
const FLIGHT_CATS = ['VFR', 'MVFR', 'IFR', 'LIFR', 'default'];

let cachedResult: { atlas: string; mapping: StationModelMapping } | null = null;

/**
 * Generate the station model sprite atlas.
 * Grid: 7 cover types × 5 flight categories = 35 icons, each 32×32.
 * Icon key format: `cover_flightcat` e.g. `SCT_VFR`, `OVC_IFR`, `CLR_default`
 */
export async function getStationModelAtlas(): Promise<{
  atlas: string;
  mapping: StationModelMapping;
}> {
  if (cachedResult) return cachedResult;

  const cols = 7; // one column per cover type
  const rows = FLIGHT_CATS.length;

  const canvas = document.createElement('canvas');
  canvas.width = cols * ICON_SIZE;
  canvas.height = rows * ICON_SIZE;
  const ctx = canvas.getContext('2d')!;

  const mapping: StationModelMapping = {};

  for (let ci = 0; ci < COVER_TYPES.length; ci++) {
    for (let fi = 0; fi < FLIGHT_CATS.length; fi++) {
      const cover = COVER_TYPES[ci];
      const fc = FLIGHT_CATS[fi];
      const color = FLIGHT_CAT_COLORS[fc] ?? DEFAULT_FC_COLOR;
      const key = `${cover}_${fc}`;

      const svg = generateCloudCoverSVG(cover, color);
      const blob = new Blob([svg], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);

      try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = reject;
          image.src = url;
        });
        ctx.drawImage(img, ci * ICON_SIZE, fi * ICON_SIZE, ICON_SIZE, ICON_SIZE);
      } catch {
        // skip
      } finally {
        URL.revokeObjectURL(url);
      }

      mapping[key] = {
        x: ci * ICON_SIZE,
        y: fi * ICON_SIZE,
        width: ICON_SIZE,
        height: ICON_SIZE,
      };
    }
  }

  cachedResult = { atlas: canvas.toDataURL('image/png'), mapping };
  return cachedResult;
}

/** Get the icon key for a station's cloud cover + flight category. */
export function getCloudCoverKey(skyCover: string | null, flightCategory: string | null): string {
  let cover: CoverType;
  switch (skyCover) {
    case 'CLR': case 'SKC': case 'CAVOK': cover = 'CLR'; break;
    case 'FEW': cover = 'FEW'; break;
    case 'SCT': cover = 'SCT'; break;
    case 'BKN': cover = 'BKN'; break;
    case 'OVC': cover = 'OVC'; break;
    case 'VV': cover = 'VV'; break;
    default: cover = 'missing';
  }
  const fc = FLIGHT_CATS.includes(flightCategory ?? '') ? flightCategory! : 'default';
  return `${cover}_${fc}`;
}
