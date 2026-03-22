import { useAppStore } from '../stores/appStore';
import GoToLocation from './GoToLocation';

/** Approximate pressure (hPa) -> flight level label */
function flightLevelLabel(hpa: number): string {
  const map: Record<number, string> = {
    850: 'FL050', 700: 'FL100', 600: 'FL140', 500: 'FL180',
    400: 'FL240', 300: 'FL300', 250: 'FL340', 200: 'FL390',
    150: 'FL450', 100: 'FL530', 70: 'FL600',
  };
  return map[hpa] ?? `${hpa} hPa`;
}

/** Format ISO timestamp for display, e.g. "21 Mar 18Z" */
function formatRunTime(iso: string): string {
  const d = new Date(iso);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${String(d.getUTCHours()).padStart(2, '0')}Z`;
}

/** Format valid time from run_time + forecast_hour */
function formatValidTime(runIso: string, fh: number): string {
  const d = new Date(new Date(runIso).getTime() + fh * 3600000);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${String(d.getUTCHours()).padStart(2, '0')}Z`;
}

export default function Toolbar() {
  const availableRuns = useAppStore((s) => s.availableRuns);
  const selectedRunTime = useAppStore((s) => s.selectedRunTime);
  const selectedForecastHour = useAppStore((s) => s.selectedForecastHour);
  const selectedLevel = useAppStore((s) => s.selectedLevel);
  const windVisible = useAppStore((s) => s.windVisible);
  const windLoading = useAppStore((s) => s.windLoading);
  const setRunTime = useAppStore((s) => s.setRunTime);
  const setForecastHour = useAppStore((s) => s.setForecastHour);
  const setLevel = useAppStore((s) => s.setLevel);
  const toggleWind = useAppStore((s) => s.toggleWind);
  const temperatureVisible = useAppStore((s) => s.temperatureVisible);
  const temperatureLoading = useAppStore((s) => s.temperatureLoading);
  const toggleTemperature = useAppStore((s) => s.toggleTemperature);
  const heightVisible = useAppStore((s) => s.heightVisible);
  const heightLoading = useAppStore((s) => s.heightLoading);
  const toggleHeight = useAppStore((s) => s.toggleHeight);
  const mapGoTo = useAppStore((s) => s.mapGoTo);
  const mapFitBounds = useAppStore((s) => s.mapFitBounds);

  const currentRun = availableRuns.find((r) => r.run_time === selectedRunTime);

  return (
    <div className="toolbar">
      <label>
        Run:
        <select
          value={selectedRunTime ?? ''}
          onChange={(e) => setRunTime(e.target.value)}
          disabled={availableRuns.length === 0}
        >
          {availableRuns.map((r) => (
            <option key={r.run_time} value={r.run_time}>
              {formatRunTime(r.run_time)}
            </option>
          ))}
        </select>
      </label>

      <label>
        Forecast:
        <select
          value={selectedForecastHour}
          onChange={(e) => setForecastHour(Number(e.target.value))}
        >
          {(currentRun?.forecast_hours ?? []).map((h) => (
            <option key={h} value={h}>
              T+{h} ({selectedRunTime ? formatValidTime(selectedRunTime, h) : ''})
            </option>
          ))}
        </select>
      </label>

      <label>
        Level:
        <select
          value={selectedLevel}
          onChange={(e) => setLevel(Number(e.target.value))}
        >
          {(currentRun?.levels ?? []).map((l) => (
            <option key={l} value={l}>
              {flightLevelLabel(l)} ({l} hPa)
            </option>
          ))}
        </select>
      </label>

      <button
        className={windVisible ? 'toggle-btn active' : 'toggle-btn'}
        onClick={toggleWind}
      >
        Wind {windLoading ? '...' : windVisible ? 'ON' : 'OFF'}
      </button>

      <button
        className={temperatureVisible ? 'toggle-btn active' : 'toggle-btn'}
        onClick={toggleTemperature}
      >
        Temp {temperatureLoading ? '...' : temperatureVisible ? 'ON' : 'OFF'}
      </button>

      <button
        className={heightVisible ? 'toggle-btn active' : 'toggle-btn'}
        onClick={toggleHeight}
      >
        Height {heightLoading ? '...' : heightVisible ? 'ON' : 'OFF'}
      </button>

      <GoToLocation
        onGoTo={(lat, lon) => mapGoTo?.(lat, lon)}
        onFitBounds={(s, w, n, e) => mapFitBounds?.(s, w, n, e)}
      />
    </div>
  );
}
