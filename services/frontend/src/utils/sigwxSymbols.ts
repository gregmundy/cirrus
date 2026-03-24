/**
 * SIGWX symbol sprite atlas using official WMO/ICAO SVG symbols.
 *
 * Symbols sourced from OGCMetOceanDWG/WorldWeatherSymbols (CC BY 4.0)
 * per WMO-No.49 Technical Regulations, Volume II, C.3.1, Appendix 1.
 */

// Import official ICAO SVG symbols as URLs (Vite handles SVG imports)
import tropicalCycloneSvg from '../assets/sigwx-symbols/tropical_cyclone.svg';
import volcanoSvg from '../assets/sigwx-symbols/volcano.svg';
import turbModSvg from '../assets/sigwx-symbols/turb_mod.svg';
import turbSevSvg from '../assets/sigwx-symbols/turb_sev.svg';
import iceModSvg from '../assets/sigwx-symbols/ice_mod.svg';
import iceSevSvg from '../assets/sigwx-symbols/ice_sev.svg';
import radiationSvg from '../assets/sigwx-symbols/radiation.svg';
import sandstormSvg from '../assets/sigwx-symbols/sandstorm.svg';
import jetArrowSvg from '../assets/sigwx-symbols/jet_arrow.svg';

const ICON_SIZE = 64;

const SYMBOL_URLS: Record<string, string> = {
  tropical_cyclone: tropicalCycloneSvg,
  volcano: volcanoSvg,
  turb_mod: turbModSvg,
  turb_sev: turbSevSvg,
  ice_mod: iceModSvg,
  ice_sev: iceSevSvg,
  radiation: radiationSvg,
  sandstorm: sandstormSvg,
  jet_arrow: jetArrowSvg,
};

export interface SigwxSymbolAtlas {
  atlas: string;
  mapping: Record<string, { x: number; y: number; width: number; height: number }>;
}

let cachedAtlas: SigwxSymbolAtlas | null = null;

/**
 * Generate the SIGWX symbol sprite atlas as a PNG data URL.
 * Loads official WMO/ICAO SVGs and renders them into a canvas.
 */
export async function getSigwxSymbolAtlas(): Promise<SigwxSymbolAtlas> {
  if (cachedAtlas) return cachedAtlas;

  const names = Object.keys(SYMBOL_URLS);
  const COLS = 5;
  const ROWS = Math.ceil(names.length / COLS);

  const canvas = document.createElement('canvas');
  canvas.width = COLS * ICON_SIZE;
  canvas.height = ROWS * ICON_SIZE;
  const ctx = canvas.getContext('2d')!;

  const mapping: Record<string, { x: number; y: number; width: number; height: number }> = {};

  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const url = SYMBOL_URLS[name];

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
      // skip failed icons
    }
  }

  cachedAtlas = {
    atlas: canvas.toDataURL('image/png'),
    mapping,
  };

  return cachedAtlas;
}
