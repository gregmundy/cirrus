import { ScatterplotLayer, TextLayer, IconLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import type { PickingInfo } from '@deck.gl/core';
import type { StationObs } from '../../stores/appStore';
import type { StationModelMapping } from '../../utils/stationModelAtlas';
import { getWindBarbKey } from '../../utils/windBarbs';
import { getCloudCoverKey } from '../../utils/stationModelAtlas';

const FLIGHT_CAT_COLORS: Record<string, [number, number, number, number]> = {
  VFR:  [0, 200, 0, 220],
  MVFR: [0, 100, 255, 220],
  IFR:  [220, 0, 0, 220],
  LIFR: [200, 0, 200, 220],
};
const DEFAULT_COLOR: [number, number, number, number] = [150, 150, 150, 180];

function wxToSymbol(wx: string): string {
  if (wx.includes('TS')) return '\u26A1';
  if (wx.includes('SN')) return '\u2744';
  if (wx.includes('FZRA')) return '\u2022\u0338';
  if (wx.includes('RA')) return '\u2022';
  if (wx.includes('DZ')) return ',';
  if (wx.includes('FG')) return '\u2261';
  if (wx.includes('BR')) return '=';
  if (wx.includes('HZ')) return '\u221E';
  if (wx.includes('FU')) return 'FU';
  if (wx.includes('SQ')) return '\u25B2';
  if (wx.includes('GR')) return '\u25B3';
  return wx.substring(0, 2);
}

/** Format sea level pressure: last 3 digits in tenths of hPa.
 *  e.g. 1013.2 hPa -> "132", 996.9 hPa -> "969" */
function formatPressure(slpHpa: number | null): string {
  if (slpHpa == null) return '';
  const tenths = Math.round(slpHpa * 10) % 1000;
  return String(tenths).padStart(3, '0');
}

// ── Low-zoom layers (simple dots) ───────────────────────────────────

export function createStationDotsLayer(
  data: StationObs[],
  onClick: (info: PickingInfo<StationObs>) => void,
): Layer | null {
  if (data.length === 0) return null;
  return new ScatterplotLayer<StationObs>({
    id: 'station-dots',
    data,
    getPosition: (d) => [d.longitude, d.latitude],
    getFillColor: (d) => FLIGHT_CAT_COLORS[d.flight_category ?? ''] ?? DEFAULT_COLOR,
    getRadius: 4,
    radiusUnits: 'pixels',
    radiusMinPixels: 3,
    radiusMaxPixels: 8,
    pickable: true,
    antialiasing: true,
    onClick,
  });
}

export function createStationLabelsLayer(data: StationObs[]): Layer | null {
  if (data.length === 0) return null;
  return new TextLayer<StationObs>({
    id: 'station-ids',
    data,
    getPosition: (d) => [d.longitude, d.latitude],
    getText: (d) => d.station,
    getSize: 10,
    getColor: [40, 40, 40, 220],
    getTextAnchor: 'start',
    getAlignmentBaseline: 'center',
    getPixelOffset: [8, 0],
    fontFamily: 'monospace',
    fontWeight: 'bold',
    sizeUnits: 'pixels',
    pickable: false,
  });
}

// ── High-zoom layers (WMO standard station model) ──────────────────

export function createStationModelLayers(
  data: StationObs[],
  onClick: (info: PickingInfo<StationObs>) => void,
  windAtlasUrl: string,
  windIconMapping: Record<string, { x: number; y: number; width: number; height: number }>,
  coverAtlasUrl: string,
  coverIconMapping: StationModelMapping,
  zoom: number = 6,
): Layer[] {
  if (data.length === 0) return [];

  // Scale factor: 1.0 at zoom 6, grows as you zoom in
  const s = Math.max(1, 1 + (zoom - 6) * 0.15);

  const circleSize = Math.round(22 * s);
  const barbSize = Math.round(36 * s);
  const textSize = Math.round(13 * s);
  const smallTextSize = Math.round(11 * s);
  const wxSize = Math.round(16 * s);
  const circleOffset = Math.round(6 * s);
  const textGap = Math.round(14 * s);
  const wxGap = Math.round(28 * s);
  const visGap = Math.round(42 * s);

  const layers: Layer[] = [];

  // 1. Cloud cover circle
  layers.push(new IconLayer<StationObs>({
    id: 'station-cloud-cover',
    data,
    getPosition: (d) => [d.longitude, d.latitude],
    getIcon: (d) => getCloudCoverKey(d.sky_cover, d.flight_category),
    getSize: circleSize,
    iconAtlas: coverAtlasUrl,
    iconMapping: coverIconMapping,
    sizeUnits: 'pixels',
    pickable: true,
    onClick,
  }));

  // 2. Wind barb — anchored at staffTop, +180° so barbs extend outward
  const withWind = data.filter(
    (d) => d.wind_speed_kt != null && d.wind_speed_kt > 0 && d.wind_dir_degrees != null,
  );
  if (withWind.length > 0) {
    layers.push(new IconLayer<StationObs>({
      id: 'station-wind-barbs',
      data: withWind,
      getPosition: (d) => [d.longitude, d.latitude],
      getIcon: (d) => getWindBarbKey(d.wind_speed_kt!),
      getAngle: (d) => d.wind_dir_degrees! + 180,
      getSize: barbSize,
      iconAtlas: windAtlasUrl,
      iconMapping: windIconMapping,
      sizeUnits: 'pixels',
      getPixelOffset: (d) => {
        const rad = (d.wind_dir_degrees! * Math.PI) / 180;
        return [Math.sin(rad) * circleOffset, -Math.cos(rad) * circleOffset];
      },
      pickable: false,
    }));
  }

  // 3. Temperature — upper-left
  const withTemp = data.filter((d) => d.temp_c != null);
  if (withTemp.length > 0) {
    layers.push(new TextLayer<StationObs>({
      id: 'station-temp',
      data: withTemp,
      getPosition: (d) => [d.longitude, d.latitude],
      getText: (d) => `${Math.round(d.temp_c!)}`,
      getSize: textSize,
      getColor: [180, 0, 0, 255],
      getTextAnchor: 'end',
      getAlignmentBaseline: 'bottom',
      getPixelOffset: [-textGap, -2],
      fontFamily: 'monospace',
      fontWeight: 'bold',
      sizeUnits: 'pixels',
      pickable: false,
    }));
  }

  // 4. Dewpoint — lower-left
  const withDew = data.filter((d) => d.dewpoint_c != null);
  if (withDew.length > 0) {
    layers.push(new TextLayer<StationObs>({
      id: 'station-dewpoint',
      data: withDew,
      getPosition: (d) => [d.longitude, d.latitude],
      getText: (d) => `${Math.round(d.dewpoint_c!)}`,
      getSize: textSize,
      getColor: [0, 80, 180, 255],
      getTextAnchor: 'end',
      getAlignmentBaseline: 'top',
      getPixelOffset: [-textGap, 2],
      fontFamily: 'monospace',
      fontWeight: 'bold',
      sizeUnits: 'pixels',
      pickable: false,
    }));
  }

  // 5. Present weather — left of circle
  const withWx = data.filter((d) => d.wx_string);
  if (withWx.length > 0) {
    layers.push(new TextLayer<StationObs>({
      id: 'station-wx',
      data: withWx,
      getPosition: (d) => [d.longitude, d.latitude],
      getText: (d) => wxToSymbol(d.wx_string!),
      getSize: wxSize,
      getColor: [140, 0, 140, 255],
      getTextAnchor: 'end',
      getAlignmentBaseline: 'center',
      getPixelOffset: [-wxGap, 0],
      fontFamily: 'sans-serif',
      fontWeight: 'bold',
      sizeUnits: 'pixels',
      pickable: false,
    }));
  }

  // 6. Visibility — far left, always shown
  const withVis = data.filter((d) => d.visibility_sm != null);
  if (withVis.length > 0) {
    layers.push(new TextLayer<StationObs>({
      id: 'station-visibility',
      data: withVis,
      getPosition: (d) => [d.longitude, d.latitude],
      getText: (d) => {
        const v = d.visibility_sm!;
        if (v >= 10) return '10+';
        if (v < 0.25) return '0';
        if (v < 1) return v.toFixed(1);
        return `${Math.round(v)}`;
      },
      getSize: smallTextSize,
      getColor: [60, 60, 60, 220],
      getTextAnchor: 'end',
      getAlignmentBaseline: 'center',
      getPixelOffset: [-visGap, 0],
      fontFamily: 'monospace',
      sizeUnits: 'pixels',
      pickable: false,
    }));
  }

  // 7. Sea level pressure — upper-right
  // Only show pressure when SLP is available — altimeter (QNH) diverges
  // from SLP at elevated stations and gives misleading values
  const withPressure = data.filter((d) => d.slp_hpa != null);
  if (withPressure.length > 0) {
    layers.push(new TextLayer<StationObs>({
      id: 'station-pressure',
      data: withPressure,
      getPosition: (d) => [d.longitude, d.latitude],
      getText: (d) => formatPressure(d.slp_hpa),
      getSize: smallTextSize,
      getColor: [40, 40, 40, 230],
      getTextAnchor: 'start',
      getAlignmentBaseline: 'bottom',
      getPixelOffset: [textGap, -2],
      fontFamily: 'monospace',
      sizeUnits: 'pixels',
      pickable: false,
    }));
  }

  // 8. Ceiling height — lower-right (in hundreds of feet)
  const withCeiling = data.filter((d) => d.ceiling_ft != null);
  if (withCeiling.length > 0) {
    layers.push(new TextLayer<StationObs>({
      id: 'station-ceiling',
      data: withCeiling,
      getPosition: (d) => [d.longitude, d.latitude],
      getText: (d) => `${Math.round(d.ceiling_ft! / 100)}`,
      getSize: smallTextSize,
      getColor: [40, 40, 40, 230],
      getTextAnchor: 'start',
      getAlignmentBaseline: 'top',
      getPixelOffset: [textGap, 2],
      fontFamily: 'monospace',
      sizeUnits: 'pixels',
      pickable: false,
    }));
  }

  // 9. Station ICAO code — lower-right below ceiling (only at zoom >= 8)
  if (zoom >= 8) {
    layers.push(new TextLayer<StationObs>({
      id: 'station-id',
      data,
      getPosition: (d) => [d.longitude, d.latitude],
      getText: (d) => d.station,
      getSize: Math.round(10 * s),
      getColor: [50, 50, 50, 220],
      getTextAnchor: 'start',
      getAlignmentBaseline: 'top',
      getPixelOffset: [textGap, Math.round(20 * s)],
      fontFamily: 'monospace',
      fontWeight: 'bold',
      sizeUnits: 'pixels',
      pickable: false,
    }));
  }

  return layers;
}
