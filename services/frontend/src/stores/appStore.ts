import { create } from 'zustand';
import type { ComputedContours, GriddedData } from '../components/map/ContourLayer';
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

  toggleStations: () => {
    const wasVisible = get().stationVisible;
    set({ stationVisible: !wasVisible });
    if (!wasVisible && get().stationData.length === 0) {
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
    set({ temperatureContours: null, heightContours: null, humidityContours: null });
    // Refetch visible layers
    if (get().temperatureVisible) get().fetchTemperatureData();
    if (get().heightVisible) get().fetchHeightData();
    if (get().humidityVisible) get().fetchHumidityData();
  },

  setForecastHour: (h: number) => {
    set({ selectedForecastHour: h });
    get().fetchWindData();
    // Clear cached contours
    set({ temperatureContours: null, heightContours: null, humidityContours: null });
    // Refetch visible layers
    if (get().temperatureVisible) get().fetchTemperatureData();
    if (get().heightVisible) get().fetchHeightData();
    if (get().humidityVisible) get().fetchHumidityData();
  },

  setLevel: (l: number) => {
    set({ selectedLevel: l });
    get().fetchWindData();
    // Clear cached contours
    set({ temperatureContours: null, heightContours: null, humidityContours: null });
    // Refetch visible layers
    if (get().temperatureVisible) get().fetchTemperatureData();
    if (get().heightVisible) get().fetchHeightData();
    if (get().humidityVisible) get().fetchHumidityData();
  },

  toggleWind: () => set((s) => ({ windVisible: !s.windVisible })),

  setMapZoom: (z: number) => set({ mapZoom: z }),
  setCursorCoords: (c) => set({ cursorCoords: c }),
}));
