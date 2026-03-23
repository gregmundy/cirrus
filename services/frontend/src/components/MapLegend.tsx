import { useAppStore } from '../stores/appStore';

const FL_MAP: Record<number, string> = {
  850: 'FL050', 700: 'FL100', 600: 'FL140', 500: 'FL180',
  400: 'FL240', 300: 'FL300', 250: 'FL340', 200: 'FL390',
  150: 'FL450', 100: 'FL530', 70: 'FL600',
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${String(d.getUTCHours()).padStart(2, '0')}Z`;
}

export default function MapLegend() {
  const dataRunTime = useAppStore((s) => s.dataRunTime);
  const dataValidTime = useAppStore((s) => s.dataValidTime);
  const selectedLevel = useAppStore((s) => s.selectedLevel);
  const windVisible = useAppStore((s) => s.windVisible);
  const temperatureVisible = useAppStore((s) => s.temperatureVisible);
  const heightVisible = useAppStore((s) => s.heightVisible);
  const humidityVisible = useAppStore((s) => s.humidityVisible);
  const tropopauseVisible = useAppStore((s) => s.tropopauseVisible);
  const maxWindVisible = useAppStore((s) => s.maxWindVisible);
  const stationVisible = useAppStore((s) => s.stationVisible);

  if (!dataRunTime) return null;

  const activeLayers: string[] = [];
  if (windVisible) activeLayers.push('Wind');
  if (temperatureVisible) activeLayers.push('Temp');
  if (heightVisible) activeLayers.push('Height');
  if (humidityVisible) activeLayers.push('RH');
  if (tropopauseVisible) activeLayers.push('Trop');
  if (maxWindVisible) activeLayers.push('Jet');
  if (stationVisible) activeLayers.push('Stations');

  const flLabel = FL_MAP[selectedLevel] ?? `${selectedLevel} hPa`;

  return (
    <div className="map-legend">
      <div className="legend-row legend-source">GFS 0.25°</div>
      <div className="legend-row">
        Run: {formatTime(dataRunTime)}
        {dataValidTime && ` | Valid: ${formatTime(dataValidTime)}`}
      </div>
      <div className="legend-row">{flLabel} ({selectedLevel} hPa)</div>
      {activeLayers.length > 0 && (
        <div className="legend-row legend-layers">{activeLayers.join(', ')}</div>
      )}
    </div>
  );
}
