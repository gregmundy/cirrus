import { useState } from 'react';

interface GoToLocationProps {
  onGoTo: (lat: number, lon: number) => void;
  onFitBounds: (south: number, west: number, north: number, east: number) => void;
}

export default function GoToLocation({ onGoTo, onFitBounds }: GoToLocationProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'center' | 'bounds'>('center');
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [south, setSouth] = useState('');
  const [west, setWest] = useState('');
  const [north, setNorth] = useState('');
  const [east, setEast] = useState('');

  const handleGo = () => {
    if (mode === 'center') {
      const la = parseFloat(lat);
      const lo = parseFloat(lon);
      if (!isNaN(la) && !isNaN(lo)) {
        onGoTo(la, lo);
        setOpen(false);
      }
    } else {
      const s = parseFloat(south);
      const w = parseFloat(west);
      const n = parseFloat(north);
      const e = parseFloat(east);
      if (!isNaN(s) && !isNaN(w) && !isNaN(n) && !isNaN(e)) {
        onFitBounds(s, w, n, e);
        setOpen(false);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleGo();
    if (e.key === 'Escape') setOpen(false);
  };

  if (!open) {
    return (
      <button className="toggle-btn" onClick={() => setOpen(true)}>
        Go To
      </button>
    );
  }

  return (
    <div className="goto-popover" onKeyDown={handleKeyDown}>
      <div className="goto-tabs">
        <button
          className={mode === 'center' ? 'goto-tab active' : 'goto-tab'}
          onClick={() => setMode('center')}
        >
          Center
        </button>
        <button
          className={mode === 'bounds' ? 'goto-tab active' : 'goto-tab'}
          onClick={() => setMode('bounds')}
        >
          Bounds
        </button>
      </div>

      {mode === 'center' ? (
        <div className="goto-fields">
          <label>
            Lat:
            <input
              type="text"
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              placeholder="38.0"
              autoFocus
            />
          </label>
          <label>
            Lon:
            <input
              type="text"
              value={lon}
              onChange={(e) => setLon(e.target.value)}
              placeholder="-95.0"
            />
          </label>
        </div>
      ) : (
        <div className="goto-fields">
          <label>
            S:
            <input
              type="text"
              value={south}
              onChange={(e) => setSouth(e.target.value)}
              placeholder="25"
              autoFocus
            />
          </label>
          <label>
            W:
            <input
              type="text"
              value={west}
              onChange={(e) => setWest(e.target.value)}
              placeholder="-130"
            />
          </label>
          <label>
            N:
            <input
              type="text"
              value={north}
              onChange={(e) => setNorth(e.target.value)}
              placeholder="50"
            />
          </label>
          <label>
            E:
            <input
              type="text"
              value={east}
              onChange={(e) => setEast(e.target.value)}
              placeholder="-65"
            />
          </label>
        </div>
      )}

      <div className="goto-actions">
        <button className="toggle-btn active" onClick={handleGo}>Go</button>
        <button className="toggle-btn" onClick={() => setOpen(false)}>✕</button>
      </div>
    </div>
  );
}
