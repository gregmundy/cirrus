interface IcaoArea {
  code: string;
  name: string;
  bounds: [number, number, number, number]; // [south, west, north, east]
}

const ICAO_AREAS: IcaoArea[] = [
  { code: 'A', name: 'Americas', bounds: [-55, -140, 70, -20] },
  { code: 'B', name: 'Atlantic/Europe/Africa', bounds: [-55, -60, 70, 70] },
  { code: 'B1', name: 'Americas/Atlantic/Europe', bounds: [-55, -140, 70, 70] },
  { code: 'C', name: 'W Pacific/E Asia', bounds: [-55, 60, 70, 150] },
  { code: 'D', name: 'E Pacific/Americas', bounds: [-55, 100, 70, 190] },
  { code: 'E', name: 'Europe/N Atlantic', bounds: [25, -70, 70, 50] },
  { code: 'F', name: 'Pacific/E Asia', bounds: [-30, 80, 40, 180] },
  { code: 'G', name: 'Middle East/S Asia', bounds: [-15, 20, 50, 90] },
  { code: 'H', name: 'C Africa/Indian Ocean', bounds: [-50, -10, 25, 70] },
  { code: 'I', name: 'S Pacific/Australia', bounds: [-55, 90, 10, 190] },
  { code: 'J', name: 'S Polar (Pacific)', bounds: [-90, -180, -25, 180] },
  { code: 'K', name: 'S Polar (Indian)', bounds: [-90, -180, -25, 180] },
  { code: 'M', name: 'N Polar', bounds: [25, -180, 90, 180] },
];

interface IcaoAreaSelectorProps {
  onFitBounds: (south: number, west: number, north: number, east: number) => void;
}

export default function IcaoAreaSelector({ onFitBounds }: IcaoAreaSelectorProps) {
  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const code = e.target.value;
    if (!code) return;
    const area = ICAO_AREAS.find((a) => a.code === code);
    if (area) {
      const [south, west, north, east] = area.bounds;
      onFitBounds(south, west, north, east);
    }
    // Reset to blank so the same area can be re-selected
    e.target.value = '';
  };

  return (
    <label>
      Area:
      <select onChange={handleChange} defaultValue="">
        <option value="">—</option>
        {ICAO_AREAS.map((a) => (
          <option key={a.code} value={a.code}>
            {a.code} — {a.name}
          </option>
        ))}
      </select>
    </label>
  );
}
