/**
 * SIGWX symbol SVG generation and sprite atlas for ICAO-standard symbology.
 *
 * Symbols per ICAO SIGWX Interpretation Guide v2.01:
 * - Volcano: inverted triangle with dot at base
 * - Tropical cyclone: spiral symbol (NH/SH variants)
 * - Radiation: trefoil symbol
 * - Sandstorm: S-shaped arrow symbol
 * - Turbulence moderate: single hat (⌃)
 * - Turbulence severe: double hat (⌃⌃)
 * - Icing moderate: single icicle line
 * - Icing severe: double icicle line
 */

const ICON_SIZE = 64;
const CX = ICON_SIZE / 2;
const CY = ICON_SIZE / 2;

/** Generate volcano symbol SVG — inverted triangle with dot at base */
function volcanoSVG(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_SIZE}" height="${ICON_SIZE}" viewBox="0 0 ${ICON_SIZE} ${ICON_SIZE}">
    <polygon points="${CX},${CY + 16} ${CX - 14},${CY - 12} ${CX + 14},${CY - 12}"
      fill="none" stroke="#dd2222" stroke-width="2.5"/>
    <circle cx="${CX}" cy="${CY + 16}" r="3" fill="#dd2222"/>
  </svg>`;
}

/** Generate tropical cyclone symbol — spiral (NH version, rotates for SH) */
function tropicalCycloneSVG(): string {
  // Simplified TC spiral using arcs
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_SIZE}" height="${ICON_SIZE}" viewBox="0 0 ${ICON_SIZE} ${ICON_SIZE}">
    <g fill="none" stroke="#9928cc" stroke-width="2.5" stroke-linecap="round">
      <path d="M ${CX} ${CY} C ${CX + 8} ${CY - 2}, ${CX + 12} ${CY - 10}, ${CX + 6} ${CY - 14}"/>
      <path d="M ${CX} ${CY} C ${CX - 8} ${CY + 2}, ${CX - 12} ${CY + 10}, ${CX - 6} ${CY + 14}"/>
      <path d="M ${CX + 6} ${CY - 14} C ${CX - 4} ${CY - 18}, ${CX - 14} ${CY - 10}, ${CX - 12} ${CY}"/>
      <path d="M ${CX - 6} ${CY + 14} C ${CX + 4} ${CY + 18}, ${CX + 14} ${CY + 10}, ${CX + 12} ${CY}"/>
    </g>
  </svg>`;
}

/** Generate radiation trefoil symbol */
function radiationSVG(): string {
  const r1 = 6; // inner radius
  const r2 = 16; // outer radius
  const bladeAngle = 50; // degrees per blade
  let paths = '';
  for (let i = 0; i < 3; i++) {
    const angle = (i * 120 - 90) * Math.PI / 180;
    const a1 = angle - (bladeAngle / 2) * Math.PI / 180;
    const a2 = angle + (bladeAngle / 2) * Math.PI / 180;
    const x1i = CX + r1 * Math.cos(a1);
    const y1i = CY + r1 * Math.sin(a1);
    const x1o = CX + r2 * Math.cos(a1);
    const y1o = CY + r2 * Math.sin(a1);
    const x2i = CX + r1 * Math.cos(a2);
    const y2i = CY + r1 * Math.sin(a2);
    const x2o = CX + r2 * Math.cos(a2);
    const y2o = CY + r2 * Math.sin(a2);
    paths += `<path d="M ${x1i} ${y1i} L ${x1o} ${y1o} A ${r2} ${r2} 0 0 1 ${x2o} ${y2o} L ${x2i} ${y2i} A ${r1} ${r1} 0 0 0 ${x1i} ${y1i} Z" fill="#cc33cc"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_SIZE}" height="${ICON_SIZE}" viewBox="0 0 ${ICON_SIZE} ${ICON_SIZE}">
    <circle cx="${CX}" cy="${CY}" r="${r1 - 1}" fill="none" stroke="#cc33cc" stroke-width="2"/>
    ${paths}
  </svg>`;
}

/** Generate sandstorm symbol — S-curve with arrow */
function sandstormSVG(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_SIZE}" height="${ICON_SIZE}" viewBox="0 0 ${ICON_SIZE} ${ICON_SIZE}">
    <g fill="none" stroke="#cc9922" stroke-width="2.5" stroke-linecap="round">
      <path d="M ${CX - 10} ${CY + 10} C ${CX - 10} ${CY}, ${CX + 10} ${CY}, ${CX + 10} ${CY - 10}"/>
      <path d="M ${CX + 6} ${CY - 15} L ${CX + 10} ${CY - 10} L ${CX + 15} ${CY - 14}" stroke-linejoin="round"/>
    </g>
  </svg>`;
}

/** Generate moderate turbulence symbol — single hat ⌃ */
function turbulenceModSVG(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_SIZE}" height="${ICON_SIZE}" viewBox="0 0 ${ICON_SIZE} ${ICON_SIZE}">
    <polyline points="${CX - 12},${CY + 4} ${CX},${CY - 10} ${CX + 12},${CY + 4}"
      fill="none" stroke="#e0a000" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

/** Generate severe turbulence symbol — double hat ⌃⌃ */
function turbulenceSevSVG(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_SIZE}" height="${ICON_SIZE}" viewBox="0 0 ${ICON_SIZE} ${ICON_SIZE}">
    <polyline points="${CX - 16},${CY + 4} ${CX - 6},${CY - 8} ${CX + 4},${CY + 4}"
      fill="none" stroke="#e0a000" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <polyline points="${CX - 4},${CY + 4} ${CX + 6},${CY - 8} ${CX + 16},${CY + 4}"
      fill="none" stroke="#e0a000" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

/** Generate moderate icing symbol — single vertical line with cross-marks */
function icingModSVG(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_SIZE}" height="${ICON_SIZE}" viewBox="0 0 ${ICON_SIZE} ${ICON_SIZE}">
    <line x1="${CX}" y1="${CY - 14}" x2="${CX}" y2="${CY + 14}" stroke="#00b4dc" stroke-width="3" stroke-linecap="round"/>
    <line x1="${CX - 8}" y1="${CY - 6}" x2="${CX}" y2="${CY - 14}" stroke="#00b4dc" stroke-width="2.5" stroke-linecap="round"/>
    <line x1="${CX + 8}" y1="${CY - 6}" x2="${CX}" y2="${CY - 14}" stroke="#00b4dc" stroke-width="2.5" stroke-linecap="round"/>
  </svg>`;
}

/** Generate severe icing symbol — double vertical lines with cross-marks */
function icingSevSVG(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_SIZE}" height="${ICON_SIZE}" viewBox="0 0 ${ICON_SIZE} ${ICON_SIZE}">
    <line x1="${CX - 6}" y1="${CY - 14}" x2="${CX - 6}" y2="${CY + 14}" stroke="#00b4dc" stroke-width="2.5" stroke-linecap="round"/>
    <line x1="${CX - 14}" y1="${CY - 6}" x2="${CX - 6}" y2="${CY - 14}" stroke="#00b4dc" stroke-width="2" stroke-linecap="round"/>
    <line x1="${CX + 2}" y1="${CY - 6}" x2="${CX - 6}" y2="${CY - 14}" stroke="#00b4dc" stroke-width="2" stroke-linecap="round"/>
    <line x1="${CX + 6}" y1="${CY - 14}" x2="${CX + 6}" y2="${CY + 14}" stroke="#00b4dc" stroke-width="2.5" stroke-linecap="round"/>
    <line x1="${CX - 2}" y1="${CY - 6}" x2="${CX + 6}" y2="${CY - 14}" stroke="#00b4dc" stroke-width="2" stroke-linecap="round"/>
    <line x1="${CX + 14}" y1="${CY - 6}" x2="${CX + 6}" y2="${CY - 14}" stroke="#00b4dc" stroke-width="2" stroke-linecap="round"/>
  </svg>`;
}

/** Generate jet stream arrowhead SVG */
function jetArrowSVG(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_SIZE}" height="${ICON_SIZE}" viewBox="0 0 ${ICON_SIZE} ${ICON_SIZE}">
    <polygon points="${CX},${CY - 16} ${CX - 10},${CY + 8} ${CX + 10},${CY + 8}"
      fill="#148c3c" stroke="#148c3c" stroke-width="1"/>
  </svg>`;
}

// All symbol generators indexed by name
const SYMBOL_GENERATORS: Record<string, () => string> = {
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
 * Renders all symbols into a single canvas for use with Deck.gl IconLayer.
 */
export async function getSigwxSymbolAtlas(): Promise<SigwxSymbolAtlas> {
  if (cachedAtlas) return cachedAtlas;

  const names = Object.keys(SYMBOL_GENERATORS);
  const COLS = 5;
  const ROWS = Math.ceil(names.length / COLS);

  const canvas = document.createElement('canvas');
  canvas.width = COLS * ICON_SIZE;
  canvas.height = ROWS * ICON_SIZE;
  const ctx = canvas.getContext('2d')!;

  const mapping: Record<string, { x: number; y: number; width: number; height: number }> = {};

  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const svg = SYMBOL_GENERATORS[name]();
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
      ctx.drawImage(img, col * ICON_SIZE, row * ICON_SIZE, ICON_SIZE, ICON_SIZE);

      mapping[name] = {
        x: col * ICON_SIZE,
        y: row * ICON_SIZE,
        width: ICON_SIZE,
        height: ICON_SIZE,
      };
    } catch {
      // skip
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  cachedAtlas = {
    atlas: canvas.toDataURL('image/png'),
    mapping,
  };

  return cachedAtlas;
}
