import type React from 'react';
import type { StationObs } from '../stores/appStore';

interface StationPopupProps {
  station: StationObs;
  x: number;
  y: number;
  onClose: () => void;
}

function formatWind(obs: StationObs): string {
  if (obs.wind_speed_kt == null) return 'Calm';
  const dir = obs.wind_dir_degrees != null ? `${obs.wind_dir_degrees}\u00B0` : 'VRB';
  const gust = obs.wind_gust_kt ? `G${obs.wind_gust_kt}` : '';
  return `${dir} at ${obs.wind_speed_kt}${gust} kt`;
}

function flightCatStyle(cat: string | null): React.CSSProperties {
  const colors: Record<string, string> = {
    VFR: '#00c800', MVFR: '#0064ff', IFR: '#dc0000', LIFR: '#c800c8',
  };
  return {
    color: colors[cat ?? ''] ?? '#999',
    fontWeight: 'bold',
  };
}

export default function StationPopup({ station, x, y, onClose }: StationPopupProps) {
  return (
    <div
      style={{
        position: 'absolute',
        left: x + 16,
        top: y - 20,
        background: 'rgba(22,33,62,0.97)',
        color: '#e0e0e0',
        padding: '10px 14px',
        borderRadius: 6,
        fontFamily: 'monospace',
        fontSize: 12,
        pointerEvents: 'auto',
        zIndex: 30,
        maxWidth: 420,
        border: '1px solid rgba(255,255,255,0.2)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontWeight: 'bold', fontSize: 14 }}>
          {station.station}
          <span style={{ ...flightCatStyle(station.flight_category), marginLeft: 8 }}>
            {station.flight_category ?? '\u2014'}
          </span>
        </span>
        <button
          onClick={onClose}
          style={{
            background: 'none', border: 'none', color: '#999', cursor: 'pointer',
            fontSize: 16, lineHeight: 1, padding: '0 4px',
          }}
        >
          x
        </button>
      </div>

      <div style={{ color: '#4fc3f7', marginBottom: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {station.raw_text}
      </div>

      <table style={{ fontSize: 11, color: '#bbb', borderSpacing: '8px 2px' }}>
        <tbody>
          <tr><td>Wind</td><td>{formatWind(station)}</td></tr>
          {station.visibility_sm != null && (
            <tr><td>Visibility</td><td>{station.visibility_sm} SM</td></tr>
          )}
          {station.ceiling_ft != null && (
            <tr><td>Ceiling</td><td>{station.ceiling_ft} ft AGL ({station.sky_cover})</td></tr>
          )}
          {station.temp_c != null && (
            <tr><td>Temp/Dew</td><td>{station.temp_c}&deg;C / {station.dewpoint_c ?? '\u2014'}&deg;C</td></tr>
          )}
          {station.altimeter_inhg != null && (
            <tr><td>Altimeter</td><td>{station.altimeter_inhg.toFixed(2)} inHg</td></tr>
          )}
          {station.wx_string && (
            <tr><td>Weather</td><td>{station.wx_string}</td></tr>
          )}
        </tbody>
      </table>

      <div style={{ fontSize: 10, color: '#666', marginTop: 6 }}>
        Observed: {new Date(station.observation_time).toUTCString()}
      </div>
    </div>
  );
}
