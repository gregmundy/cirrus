import { useAppStore } from '../stores/appStore';
import IcaoAreaSelector from './IcaoAreaSelector';

function flightLevelLabel(hpa: number): string {
  const map: Record<number, string> = {
    850: 'FL050', 700: 'FL100', 600: 'FL140', 500: 'FL180',
    400: 'FL240', 300: 'FL300', 250: 'FL340', 200: 'FL390',
    150: 'FL450', 100: 'FL530', 70: 'FL600',
  };
  return map[hpa] ?? `${hpa} hPa`;
}

function formatRunTime(iso: string): string {
  const d = new Date(iso);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${String(d.getUTCHours()).padStart(2, '0')}Z`;
}

function formatValidTime(runIso: string, fh: number): string {
  const d = new Date(new Date(runIso).getTime() + fh * 3600000);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${String(d.getUTCHours()).padStart(2, '0')}Z`;
}

interface DataPanelProps {
  collapsed: boolean;
  onToggle: () => void;
}

export default function DataPanel({ collapsed, onToggle }: DataPanelProps) {
  const availableRuns = useAppStore((s) => s.availableRuns);
  const selectedRunTime = useAppStore((s) => s.selectedRunTime);
  const selectedForecastHour = useAppStore((s) => s.selectedForecastHour);
  const selectedLevel = useAppStore((s) => s.selectedLevel);
  const setRunTime = useAppStore((s) => s.setRunTime);
  const setForecastHour = useAppStore((s) => s.setForecastHour);
  const setLevel = useAppStore((s) => s.setLevel);
  const mapFitBounds = useAppStore((s) => s.mapFitBounds);
  const satelliteChannel = useAppStore((s) => s.satelliteChannel);
  const satelliteVisible = useAppStore((s) => s.satelliteVisible);
  const setSatelliteChannel = useAppStore((s) => s.setSatelliteChannel);

  const currentRun = availableRuns.find((r) => r.run_time === selectedRunTime);

  if (collapsed) {
    return (
      <div className="panel-collapsed panel-left" onClick={onToggle} title="Expand data panel">
        <span className="panel-collapse-label">D A T A</span>
      </div>
    );
  }

  return (
    <aside className="data-panel">
      <div className="panel-header">
        <span className="panel-title">DATA</span>
        <button className="panel-collapse-btn" onClick={onToggle} title="Collapse">‹</button>
      </div>

      <div className="panel-section">
        <label className="panel-label">Model Run</label>
        <select
          className="panel-select"
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
      </div>

      <div className="panel-section">
        <label className="panel-label">Forecast Hour</label>
        <select
          className="panel-select"
          value={selectedForecastHour}
          onChange={(e) => setForecastHour(Number(e.target.value))}
        >
          {(currentRun?.forecast_hours ?? []).map((h) => (
            <option key={h} value={h}>
              T+{h} {selectedRunTime ? `(${formatValidTime(selectedRunTime, h)})` : ''}
            </option>
          ))}
        </select>
      </div>

      <div className="panel-section">
        <label className="panel-label">Flight Level</label>
        <select
          className="panel-select"
          value={selectedLevel}
          onChange={(e) => setLevel(Number(e.target.value))}
        >
          {(currentRun?.levels ?? []).map((l) => (
            <option key={l} value={l}>
              {flightLevelLabel(l)} ({l} hPa)
            </option>
          ))}
        </select>
      </div>

      <div className="panel-section">
        <label className="panel-label">ICAO Area</label>
        <div className="panel-select-wrap">
          <IcaoAreaSelector onFitBounds={(s, w, n, e) => mapFitBounds?.(s, w, n, e)} />
        </div>
      </div>

      {satelliteVisible && (
        <div className="panel-section">
          <label className="panel-label">Satellite Channel</label>
          <select
            className="panel-select"
            value={satelliteChannel}
            onChange={(e) => setSatelliteChannel(Number(e.target.value))}
          >
            <option value={13}>Ch13 — Clean IR</option>
            <option value={2}>Ch02 — Visible</option>
            <option value={8}>Ch08 — Water Vapor</option>
          </select>
        </div>
      )}

      <div className="panel-section panel-info">
        <div className="info-row">
          <span className="info-label">Source</span>
          <span className="info-value accent">GFS 0.25°</span>
        </div>
        {selectedRunTime && (
          <>
            <div className="info-row">
              <span className="info-label">Run</span>
              <span className="info-value">{formatRunTime(selectedRunTime)}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Valid</span>
              <span className="info-value">{formatValidTime(selectedRunTime, selectedForecastHour)}</span>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
