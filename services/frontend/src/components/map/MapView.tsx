import { useEffect, useRef, useState } from 'react';
import { Map, NavigationControl } from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useAppStore, windBarbStride } from '../../stores/appStore';
import { createWindBarbLayer } from './WindBarbLayer';
import { getWindBarbAtlas } from '../../utils/windBarbAtlas';
import type { WindBarbMapping } from '../../utils/windBarbs';

export default function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const [atlas, setAtlas] = useState<{
    url: string;
    mapping: WindBarbMapping;
  } | null>(null);

  const windData = useAppStore((s) => s.windData);
  const windVisible = useAppStore((s) => s.windVisible);
  const mapZoom = useAppStore((s) => s.mapZoom);
  const setMapZoom = useAppStore((s) => s.setMapZoom);
  const setCursorCoords = useAppStore((s) => s.setCursorCoords);

  // Load atlas on mount
  useEffect(() => {
    getWindBarbAtlas().then(({ atlas: a, mapping: m }) => {
      setAtlas({ url: a, mapping: m });
    });
  }, []);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new Map({
      container: containerRef.current,
      style: 'https://demotiles.maplibre.org/style.json',
      center: [0, 30],
      zoom: 2,
    });

    map.addControl(new NavigationControl(), 'top-right');

    const overlay = new MapboxOverlay({ layers: [] });
    map.addControl(overlay);

    mapRef.current = map;
    overlayRef.current = overlay;

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

  // Update Deck.gl layers when data changes
  useEffect(() => {
    if (!overlayRef.current || !atlas) return;

    const layers = [];

    if (windVisible && windData.length > 0) {
      const stride = windBarbStride(mapZoom);
      const filtered = stride === 1
        ? windData
        : windData.filter((_, i) => i % stride === 0);
      layers.push(createWindBarbLayer(filtered, atlas.url, atlas.mapping));
    }

    overlayRef.current.setProps({ layers });
  }, [windData, windVisible, mapZoom, atlas]);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }}
    />
  );
}
