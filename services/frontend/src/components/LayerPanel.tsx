import { useAppStore } from '../stores/appStore';

interface LayerDef {
  id: string;
  label: string;
  shortLabel: string;
  color: string;
  visible: boolean;
  loading: boolean;
  toggle: () => void;
  group: 'gridded' | 'sigwx' | 'obs' | 'satellite';
}

interface LayerPanelProps {
  collapsed: boolean;
  onToggle: () => void;
}

export default function LayerPanel({ collapsed, onToggle }: LayerPanelProps) {
  const windVisible = useAppStore((s) => s.windVisible);
  const windLoading = useAppStore((s) => s.windLoading);
  const toggleWind = useAppStore((s) => s.toggleWind);
  const temperatureVisible = useAppStore((s) => s.temperatureVisible);
  const temperatureLoading = useAppStore((s) => s.temperatureLoading);
  const toggleTemperature = useAppStore((s) => s.toggleTemperature);
  const heightVisible = useAppStore((s) => s.heightVisible);
  const heightLoading = useAppStore((s) => s.heightLoading);
  const toggleHeight = useAppStore((s) => s.toggleHeight);
  const humidityVisible = useAppStore((s) => s.humidityVisible);
  const humidityLoading = useAppStore((s) => s.humidityLoading);
  const toggleHumidity = useAppStore((s) => s.toggleHumidity);
  const tropopauseVisible = useAppStore((s) => s.tropopauseVisible);
  const tropopauseLoading = useAppStore((s) => s.tropopauseLoading);
  const toggleTropopause = useAppStore((s) => s.toggleTropopause);
  const maxWindVisible = useAppStore((s) => s.maxWindVisible);
  const maxWindLoading = useAppStore((s) => s.maxWindLoading);
  const toggleMaxWind = useAppStore((s) => s.toggleMaxWind);
  const stationVisible = useAppStore((s) => s.stationVisible);
  const stationLoading = useAppStore((s) => s.stationLoading);
  const toggleStations = useAppStore((s) => s.toggleStations);
  const sigwxVisible = useAppStore((s) => s.sigwxVisible);
  const sigwxLoading = useAppStore((s) => s.sigwxLoading);
  const toggleSigwx = useAppStore((s) => s.toggleSigwx);
  const satelliteVisible = useAppStore((s) => s.satelliteVisible);
  const satelliteLoading = useAppStore((s) => s.satelliteLoading);
  const toggleSatellite = useAppStore((s) => s.toggleSatellite);

  const layers: LayerDef[] = [
    { id: 'satellite', label: 'Satellite', shortLabel: 'SAT', color: '#7c8a96', visible: satelliteVisible, loading: satelliteLoading, toggle: toggleSatellite, group: 'satellite' },
    { id: 'wind', label: 'Wind Barbs', shortLabel: 'WND', color: '#5b8dd9', visible: windVisible, loading: windLoading, toggle: toggleWind, group: 'gridded' },
    { id: 'temp', label: 'Temperature', shortLabel: 'TMP', color: '#dc3c3c', visible: temperatureVisible, loading: temperatureLoading, toggle: toggleTemperature, group: 'gridded' },
    { id: 'height', label: 'Geopot. Height', shortLabel: 'HGT', color: '#2850c8', visible: heightVisible, loading: heightLoading, toggle: toggleHeight, group: 'gridded' },
    { id: 'humidity', label: 'Rel. Humidity', shortLabel: 'RH', color: '#1ea03c', visible: humidityVisible, loading: humidityLoading, toggle: toggleHumidity, group: 'gridded' },
    { id: 'tropopause', label: 'Tropopause', shortLabel: 'TRP', color: '#64b4f0', visible: tropopauseVisible, loading: tropopauseLoading, toggle: toggleTropopause, group: 'gridded' },
    { id: 'maxwind', label: 'Jet / Max Wind', shortLabel: 'JET', color: '#1a8c3a', visible: maxWindVisible, loading: maxWindLoading, toggle: toggleMaxWind, group: 'gridded' },
    { id: 'sigwx', label: 'SIGWX Charts', shortLabel: 'SWX', color: '#d4a017', visible: sigwxVisible, loading: sigwxLoading, toggle: toggleSigwx, group: 'sigwx' },
    { id: 'stations', label: 'METAR Stations', shortLabel: 'OBS', color: '#e0e0e0', visible: stationVisible, loading: stationLoading, toggle: toggleStations, group: 'obs' },
  ];

  const groups = [
    { key: 'satellite', label: 'SATELLITE' },
    { key: 'gridded', label: 'GRIDDED FIELDS' },
    { key: 'sigwx', label: 'SIGWX' },
    { key: 'obs', label: 'OBSERVATIONS' },
  ];

  if (collapsed) {
    return (
      <div className="panel-collapsed panel-right" onClick={onToggle} title="Expand layer panel">
        <span className="panel-collapse-label">L A Y E R S</span>
      </div>
    );
  }

  return (
    <aside className="layer-panel">
      <div className="panel-header">
        <button className="panel-collapse-btn" onClick={onToggle} title="Collapse">›</button>
        <span className="panel-title">LAYERS</span>
      </div>

      {groups.map((group) => {
        const groupLayers = layers.filter((l) => l.group === group.key);
        if (groupLayers.length === 0) return null;
        return (
          <div key={group.key} className="layer-group">
            <div className="layer-group-header">{group.label}</div>
            {groupLayers.map((layer) => (
              <div
                key={layer.id}
                className={`layer-row ${layer.visible ? 'active' : ''}`}
                onClick={layer.toggle}
              >
                <div
                  className="layer-swatch"
                  style={{ backgroundColor: layer.visible ? layer.color : '#444' }}
                />
                <span className="layer-name">{layer.label}</span>
                <span className="layer-status">
                  {layer.loading ? '...' : layer.visible ? 'ON' : ''}
                </span>
              </div>
            ))}
          </div>
        );
      })}
    </aside>
  );
}
