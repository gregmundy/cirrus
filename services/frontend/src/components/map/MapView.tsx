import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { Map, NavigationControl } from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { IconLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useAppStore, windBarbStride } from '../../stores/appStore';
import type { WindPoint } from '../../stores/appStore';
import { getWindBarbKey, generateWindBarbMapping } from '../../utils/windBarbs';
import { getWindBarbAtlas } from '../../utils/windBarbAtlas';
import { createTemperatureLayers, createHeightLayers, createHumidityLayers } from './ContourLayer';
import { createStationDotsLayer, createStationLabelsLayer } from './StationLayer';
import StationPopup from '../StationPopup';
import type { StationObs } from '../../stores/appStore';

export default function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const [atlasUrl, setAtlasUrl] = useState<string | null>(null);
  const iconMapping = useMemo(() => generateWindBarbMapping(), []);
  const [selectedStation, setSelectedStation] = useState<{
    obs: StationObs; x: number; y: number;
  } | null>(null);
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    speed: number;
    direction: number;
    lat: number;
    lon: number;
  } | null>(null);

  const windData = useAppStore((s) => s.windData);
  const windVisible = useAppStore((s) => s.windVisible);
  const mapZoom = useAppStore((s) => s.mapZoom);
  const setMapZoom = useAppStore((s) => s.setMapZoom);
  const setCursorCoords = useAppStore((s) => s.setCursorCoords);
  const setMapCallbacks = useAppStore((s) => s.setMapCallbacks);
  const temperatureContours = useAppStore((s) => s.temperatureContours);
  const temperatureVisible = useAppStore((s) => s.temperatureVisible);
  const heightContours = useAppStore((s) => s.heightContours);
  const heightVisible = useAppStore((s) => s.heightVisible);
  const humidityContours = useAppStore((s) => s.humidityContours);
  const humidityVisible = useAppStore((s) => s.humidityVisible);
  const stationData = useAppStore((s) => s.stationData);
  const stationVisible = useAppStore((s) => s.stationVisible);
  const fetchStationData = useAppStore((s) => s.fetchStationData);

  const handleWindHover = useCallback((info: { object?: WindPoint; x: number; y: number }) => {
    if (info.object) {
      setTooltip({
        x: info.x,
        y: info.y,
        speed: info.object.speed,
        direction: info.object.direction,
        lat: info.object.lat,
        lon: info.object.lon,
      });
    } else {
      setTooltip(null);
    }
  }, []);

  // Generate atlas asynchronously
  useEffect(() => {
    getWindBarbAtlas().then(({ atlas }) => {
      setAtlasUrl(atlas);
    });
  }, []);

  // Auto-refresh station data every 5 minutes
  useEffect(() => {
    if (!stationVisible) return;
    const timer = setInterval(() => fetchStationData(), 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [stationVisible, fetchStationData]);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new Map({
      container: containerRef.current,
      style: {
        version: 8 as const,
        glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
        sources: {
          land: {
            type: 'raster' as const,
            tiles: [
              'https://basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}@2x.png',
            ],
            tileSize: 256,
            attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
          },
          labels: {
            type: 'raster' as const,
            tiles: [
              'https://basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}@2x.png',
            ],
            tileSize: 256,
          },
        },
        layers: [
          {
            id: 'background',
            type: 'background' as const,
            paint: { 'background-color': '#b5d4e8' },
          },
          {
            id: 'land-layer',
            type: 'raster' as const,
            source: 'land',
            minzoom: 0,
            maxzoom: 19,
            paint: { 'raster-saturation': 0.3, 'raster-brightness-max': 0.85 },
          },
          {
            id: 'labels-layer',
            type: 'raster' as const,
            source: 'labels',
            minzoom: 0,
            maxzoom: 19,
          },
        ],
      },
      center: [-98, 39],
      zoom: 4,
    });

    map.addControl(new NavigationControl(), 'top-right');

    const overlay = new MapboxOverlay({ layers: [], getTooltip: null, pickingRadius: 15 });
    map.addControl(overlay);
    overlayRef.current = overlay;

    mapRef.current = map;

    // Register map navigation callbacks for GoTo feature
    setMapCallbacks(
      (lat, lon) => map.flyTo({ center: [lon, lat], zoom: 4, duration: 1500 }),
      (s, w, n, e) => map.fitBounds([[w, s], [e, n]], { padding: 20, duration: 1500 }),
    );

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

    const layers: Layer[] = [];

    // Height contours (bottom)
    if (heightVisible && heightContours) {
      layers.push(...createHeightLayers(heightContours));
    }

    // Humidity contours
    if (humidityVisible && humidityContours) {
      layers.push(...createHumidityLayers(humidityContours));
    }

    // Temperature contours
    if (temperatureVisible && temperatureContours) {
      layers.push(...createTemperatureLayers(temperatureContours));
    }

    // Wind barbs (top)
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
        getAngle: (d) => d.direction,
        getSize: 40,
        iconAtlas: atlasUrl,
        iconMapping: iconMapping as Record<string, { x: number; y: number; width: number; height: number }>,
        sizeUnits: 'pixels',
        sizeMinPixels: 20,
        sizeMaxPixels: 50,
        pickable: true,
        onHover: handleWindHover,
      }));
    }

    // Station dots and labels
    if (stationVisible && stationData.length > 0) {
      const dotsLayer = createStationDotsLayer(stationData, (info) => {
        if (info.object) {
          setSelectedStation({ obs: info.object, x: info.x, y: info.y });
        }
      });
      if (dotsLayer) layers.push(dotsLayer);
      const labelsLayer = createStationLabelsLayer(stationData);
      if (labelsLayer) layers.push(labelsLayer);
    }

    overlayRef.current.setProps({ layers });
  }, [windData, windVisible, mapZoom, atlasUrl, iconMapping, handleWindHover, temperatureContours, temperatureVisible, heightContours, heightVisible, humidityContours, humidityVisible, stationData, stationVisible]);

  return (
    <>
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }}
      />
      {tooltip && (
        <div
          style={{
            position: 'absolute',
            left: tooltip.x + 12,
            top: tooltip.y - 40,
            background: 'rgba(22,33,62,0.95)',
            color: '#e0e0e0',
            padding: '6px 10px',
            borderRadius: 4,
            fontFamily: 'monospace',
            fontSize: 12,
            pointerEvents: 'none',
            zIndex: 20,
            whiteSpace: 'nowrap',
            border: '1px solid rgba(255,255,255,0.15)',
          }}
        >
          <div>{Math.round(tooltip.speed)} kt from {Math.round(tooltip.direction)}&deg;</div>
          <div style={{ color: '#999', fontSize: 11 }}>
            {Math.abs(tooltip.lat).toFixed(1)}{tooltip.lat >= 0 ? 'N' : 'S'}{' '}
            {Math.abs(tooltip.lon).toFixed(1)}{tooltip.lon >= 0 ? 'E' : 'W'}
          </div>
        </div>
      )}
      {selectedStation && (
        <StationPopup
          station={selectedStation.obs}
          x={selectedStation.x}
          y={selectedStation.y}
          onClose={() => setSelectedStation(null)}
        />
      )}
    </>
  );
}
