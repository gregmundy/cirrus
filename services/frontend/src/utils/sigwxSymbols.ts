/**
 * SIGWX symbol SVG generation — hand-drawn to match official WMO/ICAO shapes.
 *
 * Geometry referenced from OGCMetOceanDWG/WorldWeatherSymbols (CC BY 4.0)
 * per WMO-No.49 Technical Regulations, Volume II, C.3.1, Appendix 1.
 *
 * All symbols accept color parameter for consistent styling across contexts.
 */

const SIZE = 64;
const CX = SIZE / 2;
const CY = SIZE / 2;

/** Volcano — inverted trapezoid with eruption lines and dot at base.
 *  WMO shape: wide-top narrow-bottom trapezoid with 3 eruption lines above. */
function volcanoSVG(color: string): string {
  // Trapezoid (inverted volcano shape)
  const top = CY - 12;
  const bot = CY + 14;
  const topW = 16;
  const botW = 6;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
    <path d="M${CX - botW},${bot} L${CX - topW},${top} L${CX + topW},${top} L${CX + botW},${bot}"
      fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round"/>
    <circle cx="${CX}" cy="${bot}" r="2" fill="${color}"/>
    <line x1="${CX}" y1="${top}" x2="${CX}" y2="${top - 13}" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
    <line x1="${CX + 2}" y1="${top}" x2="${CX + 8}" y2="${top - 11}" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
    <line x1="${CX - 2}" y1="${top}" x2="${CX - 8}" y2="${top - 11}" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
  </svg>`;
}

/** Tropical cyclone — circle with two curved tails (S-shape).
 *  WMO shape: circle with two symmetric arc tails extending from opposite sides. */
function tropicalCycloneSVG(color: string): string {
  const r = 12;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
    <circle cx="${CX}" cy="${CY}" r="${r}" fill="none" stroke="${color}" stroke-width="2.5"/>
    <path d="M${CX},${CY - r} C${CX + 18},${CY - r - 4} ${CX + 20},${CY + 2} ${CX + r},${CY}"
      fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M${CX},${CY + r} C${CX - 18},${CY + r + 4} ${CX - 20},${CY - 2} ${CX - r},${CY}"
      fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>
  </svg>`;
}

/** Radiation — three filled wedges around a central ring (trefoil).
 *  WMO shape: standard radiation trefoil with 3 blade sectors. */
function radiationSVG(color: string): string {
  const ri = 5;   // inner radius
  const ro = 16;  // outer radius
  const gap = 18; // half-gap angle in degrees
  let wedges = '';
  for (let i = 0; i < 3; i++) {
    const base = i * 120 - 90;
    const a1 = (base + gap) * Math.PI / 180;
    const a2 = (base + 120 - gap) * Math.PI / 180;
    const x1i = CX + ri * Math.cos(a1), y1i = CY + ri * Math.sin(a1);
    const x1o = CX + ro * Math.cos(a1), y1o = CY + ro * Math.sin(a1);
    const x2i = CX + ri * Math.cos(a2), y2i = CY + ri * Math.sin(a2);
    const x2o = CX + ro * Math.cos(a2), y2o = CY + ro * Math.sin(a2);
    wedges += `<path d="M${x1i} ${y1i} L${x1o} ${y1o} A${ro} ${ro} 0 0 1 ${x2o} ${y2o} L${x2i} ${y2i} A${ri} ${ri} 0 0 0 ${x1i} ${y1i} Z" fill="${color}"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
    <circle cx="${CX}" cy="${CY}" r="${ri}" fill="none" stroke="${color}" stroke-width="2"/>
    ${wedges}
    <circle cx="${CX}" cy="${CY}" r="${ro + 1}" fill="none" stroke="${color}" stroke-width="1.5"/>
  </svg>`;
}

/** Sandstorm — S-curve with arrow pointing right.
 *  WMO shape: two arcs forming an S with an arrowhead. */
function sandstormSVG(color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
    <g fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round">
      <path d="M${CX - 14},${CY} A 9 9 0 1 1 ${CX + 5},${CY - 9}"/>
      <path d="M${CX + 14},${CY} A 9 9 0 1 1 ${CX - 5},${CY + 9}"/>
    </g>
    <polygon points="${CX + 14},${CY} ${CX + 8},${CY - 4} ${CX + 8},${CY + 4}" fill="${color}"/>
  </svg>`;
}

/** Moderate turbulence — horizontal line with single angular hat (⌃).
 *  WMO shape: flat line with one triangular bump. */
function turbulenceModSVG(color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
    <path d="M${CX - 20},${CY + 4} L${CX - 5},${CY + 4} L${CX + 3},${CY - 10} L${CX + 11},${CY + 4} L${CX + 20},${CY + 4}"
      fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

/** Severe turbulence — horizontal line with double angular hat (⌃⌃).
 *  WMO shape: flat line with two triangular bumps. */
function turbulenceSevSVG(color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
    <path d="M${CX - 22},${CY + 4} L${CX - 12},${CY + 4} L${CX - 6},${CY - 8} L${CX},${CY + 4} L${CX + 6},${CY + 4} L${CX + 12},${CY - 8} L${CX + 18},${CY + 4} L${CX + 22},${CY + 4}"
      fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

/** Moderate icing — arc above two vertical lines (looks like an arch).
 *  WMO shape: semicircular arc on top of two parallel vertical strokes. */
function icingModSVG(color: string): string {
  const lx = CX - 3;
  const rx = CX + 3;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
    <path d="M${lx - 8},${CY} A 13 13 0 0 1 ${rx + 8},${CY}"
      fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>
    <line x1="${lx}" y1="${CY}" x2="${lx}" y2="${CY + 14}" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>
    <line x1="${rx}" y1="${CY}" x2="${rx}" y2="${CY + 14}" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>
  </svg>`;
}

/** Severe icing — arc above three vertical lines.
 *  WMO shape: same arch, but with three vertical strokes. */
function icingSevSVG(color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
    <path d="M${CX - 12},${CY} A 14 14 0 0 1 ${CX + 12},${CY}"
      fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>
    <line x1="${CX - 6}" y1="${CY}" x2="${CX - 6}" y2="${CY + 14}" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>
    <line x1="${CX}" y1="${CY}" x2="${CX}" y2="${CY + 14}" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>
    <line x1="${CX + 6}" y1="${CY}" x2="${CX + 6}" y2="${CY + 14}" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>
  </svg>`;
}

/** Jet stream arrowhead — solid filled triangle pointing up. */
function jetArrowSVG(color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
    <polygon points="${CX},${CY - 14} ${CX - 9},${CY + 8} ${CX + 9},${CY + 8}"
      fill="${color}" stroke="${color}" stroke-width="1" stroke-linejoin="round"/>
  </svg>`;
}

// Default colors per symbol type (can be overridden)
const DEFAULT_COLORS: Record<string, string> = {
  volcano: '#dd2222',
  tropical_cyclone: '#9928cc',
  radiation: '#cc33cc',
  sandstorm: '#cc9922',
  turb_mod: '#d4a017',
  turb_sev: '#d4a017',
  ice_mod: '#8c3cb8',
  ice_sev: '#8c3cb8',
  jet_arrow: '#148c3c',
};

const GENERATORS: Record<string, (color: string) => string> = {
  volcano: volcanoSVG,
  tropical_cyclone: tropicalCycloneSVG,
  radiation: radiationSVG,
  sandstorm: sandstormSVG,
  turb_mod: turbulenceModSVG,
  turb_sev: turbulenceSevSVG,
  ice_mod: icingModSVG,
  ice_sev: icingSevSVG,
  jet_arrow: jetArrowSVG,
};

export interface SigwxSymbolAtlas {
  atlas: string;
  mapping: Record<string, { x: number; y: number; width: number; height: number }>;
}

let cachedAtlas: SigwxSymbolAtlas | null = null;

/**
 * Generate the SIGWX symbol sprite atlas as a PNG data URL.
 * Hand-drawn SVGs matching official WMO/ICAO geometry.
 */
export async function getSigwxSymbolAtlas(): Promise<SigwxSymbolAtlas> {
  if (cachedAtlas) return cachedAtlas;

  const names = Object.keys(GENERATORS);
  const COLS = 5;
  const ROWS = Math.ceil(names.length / COLS);

  const canvas = document.createElement('canvas');
  canvas.width = COLS * SIZE;
  canvas.height = ROWS * SIZE;
  const ctx = canvas.getContext('2d')!;

  const mapping: Record<string, { x: number; y: number; width: number; height: number }> = {};

  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const color = DEFAULT_COLORS[name] ?? '#000000';
    const svg = GENERATORS[name](color);
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);

    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = url;
      });

      const col = i % COLS;
      const row = Math.floor(i / COLS);
      ctx.drawImage(img, col * SIZE, row * SIZE, SIZE, SIZE);

      mapping[name] = {
        x: col * SIZE,
        y: row * SIZE,
        width: SIZE,
        height: SIZE,
      };
    } catch {
      // skip
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  cachedAtlas = { atlas: canvas.toDataURL('image/png'), mapping };
  return cachedAtlas;
}
