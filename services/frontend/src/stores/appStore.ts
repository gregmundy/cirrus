import { create } from 'zustand';

export interface WindPoint {
  lat: number;
  lon: number;
  speed: number;
  direction: number;
}

export interface RunMeta {
  run_time: string;
  forecast_hours: number[];
  parameters: string[];
  levels: number[];
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

  // Derived display values
  dataRunTime: string | null;
  dataValidTime: string | null;
  dataForecastHour: number | null;

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

  mapZoom: 2,
  cursorCoords: null,

  dataRunTime: null,
  dataValidTime: null,
  dataForecastHour: null,

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
  },

  setForecastHour: (h: number) => {
    set({ selectedForecastHour: h });
    get().fetchWindData();
  },

  setLevel: (l: number) => {
    set({ selectedLevel: l });
    get().fetchWindData();
  },

  toggleWind: () => set((s) => ({ windVisible: !s.windVisible })),

  setMapZoom: (z: number) => set({ mapZoom: z }),
  setCursorCoords: (c) => set({ cursorCoords: c }),
}));
