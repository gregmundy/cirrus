import { useEffect, useRef, useState, useMemo } from 'react';
import { Map, NavigationControl } from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { IconLayer } from '@deck.gl/layers';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useAppStore, windBarbStride } from '../../stores/appStore';
import { getWindBarbKey, generateWindBarbMapping, generateWindBarbSVG } from '../../utils/windBarbs';
import type { WindBarbMapping } from '../../utils/windBarbs';

const ICON_SIZE = 64;
const COLS = 10;

/**
 * Build the wind barb sprite atlas synchronously as colored placeholders,
 * then load actual SVG barbs asynchronously into the same canvas.
 */
function createAtlasCanvas(): HTMLCanvasElement {
  const speeds = [0, ...Array.from({ length: 40 }, (_, i) => (i + 1) * 5)];
  const ROWS = Math.ceil(speeds.length / COLS);
  const canvas = document.createElement('canvas');
  canvas.width = COLS * ICON_SIZE;
  canvas.height = ROWS * ICON_SIZE;
  return canvas;
}

async function renderSVGsToCanvas(canvas: HTMLCanvasElement): Promise<void> {
  const ctx = canvas.getContext('2d')!;
  const speeds = [0, ...Array.from({ length: 40 }, (_, i) => (i + 1) * 5)];

  for (let index = 0; index < speeds.length; index++) {
    const svg = generateWindBarbSVG(speeds[index]);
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = url;
      });
      const col = index % COLS;
      const row = Math.floor(index / COLS);
      ctx.drawImage(img, col * ICON_SIZE, row * ICON_SIZE, ICON_SIZE, ICON_SIZE);
    } catch {
      // skip failed icons
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

export default function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const [atlasUrl, setAtlasUrl] = useState<string | null>(null);
  const iconMapping = useMemo(() => generateWindBarbMapping(), []);

  const windData = useAppStore((s) => s.windData);
  const windVisible = useAppStore((s) => s.windVisible);
  const mapZoom = useAppStore((s) => s.mapZoom);
  const setMapZoom = useAppStore((s) => s.setMapZoom);
  const setCursorCoords = useAppStore((s) => s.setCursorCoords);

  // Generate atlas asynchronously, convert to data URL when ready
  useEffect(() => {
    const canvas = createAtlasCanvas();
    renderSVGsToCanvas(canvas).then(() => {
      setAtlasUrl(canvas.toDataURL('image/png'));
    });
  }, []);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new Map({
      container: containerRef.current,
      style: {
        version: 8 as const,
        sources: {
          'carto-voyager': {
            type: 'raster' as const,
            tiles: [
              'https://basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}@2x.png',
            ],
            tileSize: 256,
            attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
          },
        },
        layers: [
          {
            id: 'carto-voyager-layer',
            type: 'raster' as const,
            source: 'carto-voyager',
            minzoom: 0,
            maxzoom: 19,
          },
        ],
      },
      center: [0, 30],
      zoom: 2,
    });

    map.addControl(new NavigationControl(), 'top-right');

    const overlay = new MapboxOverlay({ layers: [] });
    map.addControl(overlay);
    overlayRef.current = overlay;

    mapRef.current = map;

    map.on('zoomend', () => setMapZoom(map.getZoom()));

    let lastCoordUpdate = 0;
    map.on('mousemove', (e) => {
      const now = Date.now();
      if (now - lastCoordUpdate > 16) {
        setCursorCoords({ lat: e.lngLat.lat, lon: e.lngLat.lng });
        lastCoordUpdate = now;
      }
    });
    map.on('mouseout', () => setCursorCoords(null));

    return () => {
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
    };
  }, []);

  // Update Deck.gl layers
  useEffect(() => {
    if (!overlayRef.current || !atlasUrl) return;

    const layers: IconLayer[] = [];

    if (windVisible && windData.length > 0) {
      const stride = windBarbStride(mapZoom);
      const filtered = stride === 1
        ? windData
        : windData.filter((_, i) => i % stride === 0);

      layers.push(new IconLayer({
        id: 'wind-barbs',
        data: filtered,
        getPosition: (d) => [d.lon, d.lat],
        getIcon: (d) => getWindBarbKey(d.speed),
        getAngle: (d) => -d.direction,
        getSize: 40,
        iconAtlas: atlasUrl,
        iconMapping: iconMapping as Record<string, { x: number; y: number; width: number; height: number }>,
        sizeUnits: 'pixels',
        sizeMinPixels: 20,
        sizeMaxPixels: 50,
        pickable: false,
      }));
    }

    overlayRef.current.setProps({ layers });
  }, [windData, windVisible, mapZoom, atlasUrl, iconMapping]);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }}
    />
  );
}
