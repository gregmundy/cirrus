import { create } from 'zustand';
import type { ComputedContours, GriddedData } from '../components/map/ContourLayer';
import type { SigwxGeoJSON } from '../components/map/SigwxLayer';
import type { SatelliteData } from '../components/map/SatelliteLayer';
import { computeContoursAsync } from '../utils/contourWorkerClient';

export type { GriddedData } from '../components/map/ContourLayer';

export interface WindPoint {
  lat: number;
  lon: number;
  speed: number;
  direction: number;
}

export interface StationObs {
  station: string;
  observation_time: string;
  raw_text: string;
  flight_category: string | null;
  wind_dir_degrees: number | null;
  wind_speed_kt: number | null;
  wind_gust_kt: number | null;
  visibility_sm: number | null;
  wx_string: string | null;
  sky_cover: string | null;
  ceiling_ft: number | null;
  temp_c: number | null;
  dewpoint_c: number | null;
  altimeter_inhg: number | null;
  slp_hpa: number | null;
  latitude: number;
  longitude: number;
}

export interface RunMeta {
  run_time: string;
  forecast_hours: number[];
  parameters: string[];
  levels: number[];
}

function kelvinToCelsius(k: number): number {
  return k - 273.15;
}

interface AppState {
  // Wind data
  windData: WindPoint[];
  windLoading: boolean;
  windError: string | null;

  // Selections
  selectedRunTime: string | null;
  selectedForecastHour: number;
  selectedLevel: number;
  windVisible: boolean;

  // Available data
  availableRuns: RunMeta[];
  metaLoading: boolean;

  // Map state
  mapZoom: number;
  cursorCoords: { lat: number; lon: number } | null;
  mapGoTo: ((lat: number, lon: number) => void) | null;
  mapFitBounds: ((south: number, west: number, north: number, east: number) => void) | null;
  setMapCallbacks: (goTo: (lat: number, lon: number) => void, fitBounds: (s: number, w: number, n: number, e: number) => void) => void;

  // Derived display values
  dataRunTime: string | null;
  dataValidTime: string | null;
  dataForecastHour: number | null;

  // Temperature (pre-computed contours)
  temperatureContours: ComputedContours | null;
  temperatureVisible: boolean;
  temperatureLoading: boolean;
  temperatureError: string | null;
  toggleTemperature: () => void;
  fetchTemperatureData: () => Promise<void>;

  // Height (pre-computed contours)
  heightContours: ComputedContours | null;
  heightVisible: boolean;
  heightLoading: boolean;
  heightError: string | null;
  toggleHeight: () => void;
  fetchHeightData: () => Promise<void>;

  // Humidity (pre-computed contours)
  humidityContours: ComputedContours | null;
  humidityVisible: boolean;
  humidityLoading: boolean;
  humidityError: string | null;
  toggleHumidity: () => void;
  fetchHumidityData: () => Promise<void>;

  // Stations (OPMET)
  stationData: StationObs[];
  stationVisible: boolean;
  stationLoading: boolean;
  stationError: string | null;
  toggleStations: () => void;
  fetchStationData: () => Promise<void>;

  // Tropopause (pre-computed contours)
  tropopauseContours: ComputedContours | null;
  tropopauseVisible: boolean;
  tropopauseLoading: boolean;
  tropopauseError: string | null;
  tropopauseTempData: { lats: number[]; lons: number[]; values: number[]; ni: number; nj: number } | null;
  toggleTropopause: () => void;
  fetchTropopauseData: () => Promise<void>;

  // Max Wind / Jet Stream
  maxWindVisible: boolean;
  maxWindLoading: boolean;
  maxWindError: string | null;
  maxWindContours: ComputedContours | null;
  maxWindBarbs: { lat: number; lon: number; speed: number; direction: number; fl: number }[];
  toggleMaxWind: () => void;
  fetchMaxWindData: () => Promise<void>;

  // SIGWX
  sigwxVisible: boolean;
  sigwxLoading: boolean;
  sigwxError: string | null;
  sigwxFeatures: SigwxGeoJSON[];
  toggleSigwx: () => void;
  fetchSigwxData: () => Promise<void>;

  // Satellite
  satelliteVisible: boolean;
  satelliteChannel: number;
  satelliteLoading: boolean;
  satelliteError: string | null;
  satelliteData: SatelliteData | null;
  toggleSatellite: () => void;
  setSatelliteChannel: (ch: number) => void;
  fetchSatelliteData: () => Promise<void>;

  // Actions
  fetchMeta: () => Promise<void>;
  fetchWindData: () => Promise<void>;
  setRunTime: (rt: string) => void;
  setForecastHour: (h: number) => void;
  setLevel: (l: number) => void;
  toggleWind: () => void;
  setMapZoom: (z: number) => void;
  setCursorCoords: (c: { lat: number; lon: number } | null) => void;
}

/**
 * Zoom-dependent stride for client-side wind barb thinning.
 * Applied on top of the server-side `thin` parameter.
 */
export function windBarbStride(zoom: number): number {
  if (zoom < 3) return 4;
  if (zoom < 4) return 3;
  if (zoom < 5) return 2;
  return 1;
}

/** Fetch gridded data from the backend and compute contours in a Web Worker. */
async function fetchAndContour(
  parameter: string,
  type: 'temperature' | 'height' | 'humidity',
  selectedRunTime: string | null,
  selectedForecastHour: number,
  selectedLevel: number,
): Promise<ComputedContours> {
  const params = new URLSearchParams({
    parameter,
    level_hpa: String(selectedLevel),
    forecast_hour: String(selectedForecastHour),
    thin: '2',
  });
  if (selectedRunTime) params.set('run_time', selectedRunTime);

  const res = await fetch(`/api/gridded?${params}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data: GriddedData = await res.json();

  // Convert temperature values before sending to worker (K → °C)
  let values = data.values;
  let labelSuffix: string;
  let interval: number;
  let upsampleFactor = 4;

  if (type === 'temperature') {
    values = values.map(kelvinToCelsius);
    labelSuffix = '°C';
    interval = 5;
  } else if (type === 'humidity') {
    labelSuffix = '%';
    interval = 10;
    upsampleFactor = 6;
  } else {
    labelSuffix = 'm';
    interval = selectedLevel < 400 ? 60 : 30;
  }

  // Compute contours off the main thread
  const result = await computeContoursAsync({
    type,
    ni: data.ni,
    nj: data.nj,
    lats: data.lats,
    lons: data.lons,
    values,
    interval,
    upsampleFactor,
    labelSuffix,
    influenceRadius: 30,
    minSeparationDeg: 25,
  });

  return {
    lines: result.lines,
    labels: result.labels,
    extrema: result.extrema,
  };
}

export const useAppStore = create<AppState>((set, get) => ({
  windData: [],
  windLoading: false,
  windError: null,

  selectedRunTime: null,
  selectedForecastHour: 6,
  selectedLevel: 300,
  windVisible: true,

  availableRuns: [],
  metaLoading: false,

  mapZoom: 4,
  cursorCoords: null,
  mapGoTo: null,
  mapFitBounds: null,
  setMapCallbacks: (goTo, fitBounds) => set({ mapGoTo: goTo, mapFitBounds: fitBounds }),

  dataRunTime: null,
  dataValidTime: null,
  dataForecastHour: null,

  temperatureContours: null,
  temperatureVisible: false,
  temperatureLoading: false,
  temperatureError: null,

  heightContours: null,
  heightVisible: false,
  heightLoading: false,
  heightError: null,

  humidityContours: null,
  humidityVisible: false,
  humidityLoading: false,
  humidityError: null,

  stationData: [],
  stationVisible: false,
  stationLoading: false,
  stationError: null,

  tropopauseContours: null,
  tropopauseVisible: false,
  tropopauseLoading: false,
  tropopauseError: null,
  tropopauseTempData: null,

  maxWindVisible: false,
  maxWindLoading: false,
  maxWindError: null,
  maxWindContours: null,
  maxWindBarbs: [],

  sigwxVisible: false,
  sigwxLoading: false,
  sigwxError: null,
  sigwxFeatures: [],

  satelliteVisible: false,
  satelliteChannel: 13,
  satelliteLoading: false,
  satelliteError: null,
  satelliteData: null,

  toggleStations: () => {
    const wasVisible = get().stationVisible;
    set({ stationVisible: !wasVisible });
    if (!wasVisible) {
      get().fetchStationData();
    }
  },

  fetchStationData: async () => {
    set({ stationLoading: true, stationError: null });
    try {
      const res = await fetch('/api/opmet/stations');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: StationObs[] = await res.json();
      set({ stationData: data, stationLoading: false });
    } catch (err) {
      set({
        stationError: err instanceof Error ? err.message : 'Unknown error',
        stationLoading: false,
      });
    }
  },

  toggleTemperature: () => {
    const wasVisible = get().temperatureVisible;
    set({ temperatureVisible: !wasVisible });
    if (!wasVisible && !get().temperatureContours) {
      get().fetchTemperatureData();
    }
  },

  toggleHeight: () => {
    const wasVisible = get().heightVisible;
    set({ heightVisible: !wasVisible });
    if (!wasVisible && !get().heightContours) {
      get().fetchHeightData();
    }
  },

  toggleHumidity: () => {
    const wasVisible = get().humidityVisible;
    set({ humidityVisible: !wasVisible });
    if (!wasVisible && !get().humidityContours) {
      get().fetchHumidityData();
    }
  },

  toggleTropopause: () => {
    const wasVisible = get().tropopauseVisible;
    set({ tropopauseVisible: !wasVisible });
    if (!wasVisible && !get().tropopauseContours) {
      get().fetchTropopauseData();
    }
  },

  fetchTropopauseData: async () => {
    const { selectedRunTime, selectedForecastHour } = get();
    set({ tropopauseLoading: true, tropopauseError: null });
    try {
      // Fetch tropopause pressure for contours
      const params = new URLSearchParams({
        parameter: 'PRES',
        level_hpa: '-1',
        level_type: 'tropopause',
        forecast_hour: String(selectedForecastHour),
        thin: '2',
      });
      if (selectedRunTime) params.set('run_time', selectedRunTime);

      const res = await fetch(`/api/gridded?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: GriddedData = await res.json();

      // Convert pressure (Pa) to flight level for contouring
      // Use raw float values — rounding before contouring creates blocky artifacts
      const flValues = data.values.map((p: number) =>
        (1 - Math.pow(p / 101325, 0.190284)) * 145366.45 / 100
      );

      const contours = await computeContoursAsync({
        type: 'tropopause',
        ni: data.ni,
        nj: data.nj,
        lats: data.lats,
        lons: data.lons,
        values: flValues,
        interval: 20,
        upsampleFactor: 4,
        labelSuffix: '',
        influenceRadius: 30,
        minSeparationDeg: 25,
      });

      // Prepend "FL" to tropopause contour labels
      contours.labels = contours.labels.map(l => ({
        ...l,
        text: `FL${l.text}`,
      }));

      // Also fetch tropopause temperature for tooltips
      const tempParams = new URLSearchParams({
        parameter: 'TMP',
        level_hpa: '-1',
        level_type: 'tropopause',
        forecast_hour: String(selectedForecastHour),
        thin: '2',
      });
      if (selectedRunTime) tempParams.set('run_time', selectedRunTime);

      let tempData = null;
      try {
        const tempRes = await fetch(`/api/gridded?${tempParams}`);
        if (tempRes.ok) {
          const td: GriddedData = await tempRes.json();
          tempData = {
            lats: td.lats,
            lons: td.lons,
            values: td.values.map((k: number) => k - 273.15), // K → °C
            ni: td.ni,
            nj: td.nj,
          };
        }
      } catch {
        // Temperature tooltip is optional — don't fail if unavailable
      }

      set({
        tropopauseContours: { lines: contours.lines, labels: contours.labels },
        tropopauseTempData: tempData,
        tropopauseLoading: false,
      });
    } catch (err) {
      set({
        tropopauseError: err instanceof Error ? err.message : 'Unknown error',
        tropopauseLoading: false,
      });
    }
  },

  toggleMaxWind: () => {
    const wasVisible = get().maxWindVisible;
    set({ maxWindVisible: !wasVisible });
    if (!wasVisible && !get().maxWindContours) {
      get().fetchMaxWindData();
    }
  },

  fetchMaxWindData: async () => {
    const { selectedRunTime, selectedForecastHour } = get();
    set({ maxWindLoading: true, maxWindError: null });
    try {
      // Fetch max wind data from dedicated endpoint
      const params = new URLSearchParams({
        forecast_hour: String(selectedForecastHour),
        thin: '2',
      });
      if (selectedRunTime) params.set('run_time', selectedRunTime);

      const res = await fetch(`/api/maxwind?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      // Build wind speed grid for isotach contouring
      const speeds: number[] = data.speeds;

      // Compute unique sorted lats and lons to determine grid dimensions
      const uniqueLats = [...new Set(data.lats as number[])].sort((a: number, b: number) => b - a);
      const uniqueLons = [...new Set(data.lons as number[])].sort((a: number, b: number) => a - b);
      const ni = uniqueLons.length;
      const nj = uniqueLats.length;

      // Build lookup maps for O(1) index resolution
      const latIndex = new Map<number, number>();
      uniqueLats.forEach((v, i) => latIndex.set(v, i));
      const lonIndex = new Map<number, number>();
      uniqueLons.forEach((v, i) => lonIndex.set(v, i));

      // Build a 2D grid of speeds (row-major: nj rows of ni columns)
      const gridSpeeds = new Array(nj * ni).fill(0);
      for (let k = 0; k < data.count; k++) {
        const jIdx = latIndex.get(data.lats[k]);
        const iIdx = lonIndex.get(data.lons[k]);
        if (jIdx !== undefined && iIdx !== undefined) {
          gridSpeeds[jIdx * ni + iIdx] = speeds[k];
        }
      }

      const contours = await computeContoursAsync({
        type: 'maxwind',
        ni,
        nj,
        lats: uniqueLats,
        lons: uniqueLons,
        values: gridSpeeds,
        interval: 20,
        upsampleFactor: 4,
        labelSuffix: 'kt',
        influenceRadius: 30,
        minSeparationDeg: 25,
      });

      // Build wind barb data for points >= 60kt
      const barbs: { lat: number; lon: number; speed: number; direction: number; fl: number }[] = [];
      for (let k = 0; k < data.count; k++) {
        if (data.speeds[k] >= 60) {
          barbs.push({
            lat: data.lats[k],
            lon: data.lons[k],
            speed: data.speeds[k],
            direction: data.directions[k],
            fl: data.flight_levels[k],
          });
        }
      }

      set({
        maxWindContours: { lines: contours.lines, labels: contours.labels },
        maxWindBarbs: barbs,
        maxWindLoading: false,
      });
    } catch (err) {
      set({
        maxWindError: err instanceof Error ? err.message : 'Unknown error',
        maxWindLoading: false,
      });
    }
  },

  toggleSigwx: () => {
    const wasVisible = get().sigwxVisible;
    set({ sigwxVisible: !wasVisible });
    if (!wasVisible && get().sigwxFeatures.length === 0) {
      get().fetchSigwxData();
    }
  },

  fetchSigwxData: async () => {
    set({ sigwxLoading: true, sigwxError: null });
    try {
      const res = await fetch('/api/sigwx');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      set({ sigwxFeatures: data.features ?? [], sigwxLoading: false });
    } catch (err) {
      set({
        sigwxError: err instanceof Error ? err.message : 'Unknown error',
        sigwxLoading: false,
      });
    }
  },

  toggleSatellite: () => {
    const wasVisible = get().satelliteVisible;
    set({ satelliteVisible: !wasVisible });
    if (!wasVisible && !get().satelliteData) {
      get().fetchSatelliteData();
    }
  },

  setSatelliteChannel: (ch: number) => {
    set({ satelliteChannel: ch, satelliteData: null });
    if (get().satelliteVisible) {
      get().fetchSatelliteData();
    }
  },

  fetchSatelliteData: async () => {
    const { satelliteChannel } = get();
    set({ satelliteLoading: true, satelliteError: null });
    try {
      const res = await fetch(`/api/satellite/${satelliteChannel}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      set({ satelliteData: data, satelliteLoading: false });
    } catch (err) {
      set({
        satelliteError: err instanceof Error ? err.message : 'Unknown error',
        satelliteLoading: false,
      });
    }
  },

  fetchTemperatureData: async () => {
    const { selectedRunTime, selectedForecastHour, selectedLevel } = get();
    set({ temperatureLoading: true, temperatureError: null });
    try {
      const contours = await fetchAndContour('TMP', 'temperature', selectedRunTime, selectedForecastHour, selectedLevel);
      set({ temperatureContours: contours, temperatureLoading: false });
    } catch (err) {
      set({
        temperatureError: err instanceof Error ? err.message : 'Unknown error',
        temperatureLoading: false,
      });
    }
  },

  fetchHeightData: async () => {
    const { selectedRunTime, selectedForecastHour, selectedLevel } = get();
    set({ heightLoading: true, heightError: null });
    try {
      const contours = await fetchAndContour('HGT', 'height', selectedRunTime, selectedForecastHour, selectedLevel);
      set({ heightContours: contours, heightLoading: false });
    } catch (err) {
      set({
        heightError: err instanceof Error ? err.message : 'Unknown error',
        heightLoading: false,
      });
    }
  },

  fetchHumidityData: async () => {
    const { selectedRunTime, selectedForecastHour, selectedLevel } = get();
    set({ humidityLoading: true, humidityError: null });
    try {
      const contours = await fetchAndContour('RH', 'humidity', selectedRunTime, selectedForecastHour, selectedLevel);
      set({ humidityContours: contours, humidityLoading: false });
    } catch (err) {
      set({
        humidityError: err instanceof Error ? err.message : 'Unknown error',
        humidityLoading: false,
      });
    }
  },

  fetchMeta: async () => {
    set({ metaLoading: true });
    try {
      const res = await fetch('/api/gridded/meta');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const runs: RunMeta[] = data.runs ?? [];
      set({ availableRuns: runs, metaLoading: false });

      // Auto-select most recent run and first forecast hour if not already set
      if (runs.length > 0 && !get().selectedRunTime) {
        const latest = runs[0];
        set({
          selectedRunTime: latest.run_time,
          selectedForecastHour: latest.forecast_hours[0] ?? 6,
          selectedLevel: latest.levels.includes(300) ? 300 : (latest.levels[0] ?? 300),
        });
        get().fetchWindData();
      }
    } catch {
      set({ metaLoading: false });
    }
  },

  fetchWindData: async () => {
    const { selectedRunTime, selectedForecastHour, selectedLevel } = get();
    set({ windLoading: true, windError: null });

    try {
      const params = new URLSearchParams({
        level_hpa: String(selectedLevel),
        forecast_hour: String(selectedForecastHour),
        thin: '8',
      });
      if (selectedRunTime) {
        params.set('run_time', selectedRunTime);
      }

      const res = await fetch(`/api/wind?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const points: WindPoint[] = [];
      for (let i = 0; i < data.count; i++) {
        points.push({
          lat: data.lats[i],
          lon: data.lons[i],
          speed: data.speeds[i],
          direction: data.directions[i],
        });
      }

      set({
        windData: points,
        windLoading: false,
        dataRunTime: data.run_time ?? null,
        dataValidTime: data.valid_time ?? null,
        dataForecastHour: data.forecast_hour ?? null,
      });
    } catch (err) {
      set({
        windError: err instanceof Error ? err.message : 'Unknown error',
        windLoading: false,
      });
    }
  },

  setRunTime: (rt: string) => {
    const run = get().availableRuns.find(r => r.run_time === rt);
    const updates: Partial<AppState> = { selectedRunTime: rt };
    // Reset forecast hour if current selection isn't available in new run
    if (run && !run.forecast_hours.includes(get().selectedForecastHour)) {
      updates.selectedForecastHour = run.forecast_hours[0] ?? 6;
    }
    if (run && !run.levels.includes(get().selectedLevel)) {
      updates.selectedLevel = run.levels.includes(300) ? 300 : (run.levels[0] ?? 300);
    }
    set(updates);
    get().fetchWindData();
    // Clear cached contours
    set({ temperatureContours: null, heightContours: null, humidityContours: null, tropopauseContours: null, tropopauseTempData: null, maxWindContours: null, maxWindBarbs: [], sigwxFeatures: [] });
    // Refetch visible layers
    if (get().temperatureVisible) get().fetchTemperatureData();
    if (get().heightVisible) get().fetchHeightData();
    if (get().humidityVisible) get().fetchHumidityData();
    if (get().tropopauseVisible) get().fetchTropopauseData();
    if (get().maxWindVisible) get().fetchMaxWindData();
    if (get().sigwxVisible) get().fetchSigwxData();
  },

  setForecastHour: (h: number) => {
    set({ selectedForecastHour: h });
    get().fetchWindData();
    // Clear cached contours
    set({ temperatureContours: null, heightContours: null, humidityContours: null, tropopauseContours: null, tropopauseTempData: null, maxWindContours: null, maxWindBarbs: [], sigwxFeatures: [] });
    // Refetch visible layers
    if (get().temperatureVisible) get().fetchTemperatureData();
    if (get().heightVisible) get().fetchHeightData();
    if (get().humidityVisible) get().fetchHumidityData();
    if (get().tropopauseVisible) get().fetchTropopauseData();
    if (get().maxWindVisible) get().fetchMaxWindData();
    if (get().sigwxVisible) get().fetchSigwxData();
  },

  setLevel: (l: number) => {
    set({ selectedLevel: l });
    get().fetchWindData();
    // Clear cached contours
    set({ temperatureContours: null, heightContours: null, humidityContours: null, tropopauseContours: null, tropopauseTempData: null, maxWindContours: null, maxWindBarbs: [], sigwxFeatures: [] });
    // Refetch visible layers
    if (get().temperatureVisible) get().fetchTemperatureData();
    if (get().heightVisible) get().fetchHeightData();
    if (get().humidityVisible) get().fetchHumidityData();
    if (get().tropopauseVisible) get().fetchTropopauseData();
    if (get().maxWindVisible) get().fetchMaxWindData();
    if (get().sigwxVisible) get().fetchSigwxData();
  },

  toggleWind: () => set((s) => ({ windVisible: !s.windVisible })),

  setMapZoom: (z: number) => set({ mapZoom: z }),
  setCursorCoords: (c) => set({ cursorCoords: c }),
}));
