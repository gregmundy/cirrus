import { useAppStore } from '../stores/appStore';

function formatCoord(lat: number, lon: number): string {
  const latStr = `${Math.abs(lat).toFixed(1)}\u00B0${lat >= 0 ? 'N' : 'S'}`;
  const lonStr = `${Math.abs(lon).toFixed(1)}\u00B0${lon >= 0 ? 'E' : 'W'}`;
  return `${latStr} ${lonStr}`;
}

function formatRunTime(iso: string): string {
  const d = new Date(iso);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${String(d.getUTCHours()).padStart(2, '0')}Z`;
}

export default function StatusBar() {
  const cursorCoords = useAppStore((s) => s.cursorCoords);
  const dataRunTime = useAppStore((s) => s.dataRunTime);
  const dataValidTime = useAppStore((s) => s.dataValidTime);
  const dataForecastHour = useAppStore((s) => s.dataForecastHour);
  const windError = useAppStore((s) => s.windError);

  return (
    <div className="status-bar">
      <div className="status-left">
        {windError ? (
          <span className="error">{windError}</span>
        ) : dataRunTime ? (
          <span>
            Run: {formatRunTime(dataRunTime)}
            {dataForecastHour != null && ` | T+${dataForecastHour}`}
            {dataValidTime && ` | Valid: ${formatRunTime(dataValidTime)}`}
          </span>
        ) : (
          <span>No data loaded</span>
        )}
      </div>
      <div className="status-right">
        {cursorCoords ? formatCoord(cursorCoords.lat, cursorCoords.lon) : ''}
      </div>
    </div>
  );
}
