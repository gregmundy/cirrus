import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { Map, NavigationControl } from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { IconLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useAppStore, windBarbStride } from '../../stores/appStore';
import type { WindPoint } from '../../stores/appStore';
import { getWindBarbKey, generateWindBarbMapping } from '../../utils/windBarbs';
import { getWindBarbAtlas, getStationWindBarbAtlas, getJetWindBarbAtlas } from '../../utils/windBarbAtlas';
import { createTemperatureLayers, createHeightLayers, createHumidityLayers, createTropopauseLayers, createMaxWindIsotachLayers } from './ContourLayer';
import { createSigwxLayers } from './SigwxLayer';
import { getSigwxSymbolAtlas } from '../../utils/sigwxSymbols';
import type { SigwxSymbolAtlas } from '../../utils/sigwxSymbols';
import { createStationDotsLayer, createStationLabelsLayer, createStationModelLayers } from './StationLayer';
import { getStationModelAtlas } from '../../utils/stationModelAtlas';
import type { StationModelMapping } from '../../utils/stationModelAtlas';
import StationPopup from '../StationPopup';
import MapLegend from '../MapLegend';
import type { StationObs } from '../../stores/appStore';

export default function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const [atlasUrl, setAtlasUrl] = useState<string | null>(null);
  const [stationBarbAtlasUrl, setStationBarbAtlasUrl] = useState<string | null>(null);
  const [stationBarbMapping, setStationBarbMapping] = useState<Record<string, { x: number; y: number; width: number; height: number; anchorY: number }> | null>(null);
  const [coverAtlasUrl, setCoverAtlasUrl] = useState<string | null>(null);
  const [coverIconMapping, setCoverIconMapping] = useState<StationModelMapping | null>(null);
  const [jetBarbAtlasUrl, setJetBarbAtlasUrl] = useState<string | null>(null);
  const [sigwxAtlas, setSigwxAtlas] = useState<SigwxSymbolAtlas | null>(null);
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
  const tropopauseContours = useAppStore((s) => s.tropopauseContours);
  const tropopauseVisible = useAppStore((s) => s.tropopauseVisible);
  const maxWindContours = useAppStore((s) => s.maxWindContours);
  const maxWindVisible = useAppStore((s) => s.maxWindVisible);
  const maxWindBarbs = useAppStore((s) => s.maxWindBarbs);
  const sigwxFeatures = useAppStore((s) => s.sigwxFeatures);
  const sigwxVisible = useAppStore((s) => s.sigwxVisible);

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

  // Generate icon atlases asynchronously
  useEffect(() => {
    getWindBarbAtlas().then(({ atlas }) => setAtlasUrl(atlas));
    getJetWindBarbAtlas().then(({ atlas }) => setJetBarbAtlasUrl(atlas));
    getSigwxSymbolAtlas().then((a) => setSigwxAtlas(a));
    getStationWindBarbAtlas().then(({ atlas, mapping }) => {
      setStationBarbAtlasUrl(atlas);
      setStationBarbMapping(mapping);
    });
    getStationModelAtlas().then(({ atlas, mapping }) => {
      setCoverAtlasUrl(atlas);
      setCoverIconMapping(mapping);
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

    map.on('zoom', () => setMapZoom(map.getZoom()));

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

    // Tropopause contours (dotted blue lines)
    if (tropopauseVisible && tropopauseContours) {
      layers.push(...createTropopauseLayers(tropopauseContours));
    }

    // Humidity contours
    if (humidityVisible && humidityContours) {
      layers.push(...createHumidityLayers(humidityContours));
    }

    // Temperature contours
    if (temperatureVisible && temperatureContours) {
      layers.push(...createTemperatureLayers(temperatureContours));
    }

    // Max wind isotach contours (green lines)
    if (maxWindVisible && maxWindContours) {
      layers.push(...createMaxWindIsotachLayers(maxWindContours));
    }

    // Max wind barbs (green, >= 60kt)
    if (maxWindVisible && maxWindBarbs.length > 0 && jetBarbAtlasUrl) {
      const jetStride = windBarbStride(mapZoom);
      const filteredJetBarbs = jetStride === 1
        ? maxWindBarbs
        : maxWindBarbs.filter((_, i) => i % jetStride === 0);

      layers.push(new IconLayer({
        id: 'maxwind-barbs',
        data: filteredJetBarbs,
        getPosition: (d) => [d.lon, d.lat],
        getIcon: (d) => getWindBarbKey(d.speed),
        getAngle: (d) => d.direction,
        getSize: 40,
        iconAtlas: jetBarbAtlasUrl,
        iconMapping: iconMapping as Record<string, { x: number; y: number; width: number; height: number }>,
        sizeUnits: 'pixels',
        sizeMinPixels: 20,
        sizeMaxPixels: 50,
        pickable: false,
      }));
    }

    // SIGWX features (polygons, lines, points)
    if (sigwxVisible && sigwxFeatures.length > 0) {
      layers.push(...createSigwxLayers(
        sigwxFeatures,
        sigwxAtlas,
        jetBarbAtlasUrl,
        iconMapping as Record<string, { x: number; y: number; width: number; height: number }>,
        mapZoom,
      ));
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

    // Station observations — full model at zoom >= 6, simple dots at lower zoom
    if (stationVisible && stationData.length > 0) {
      const stationClick = (info: { object?: StationObs; x: number; y: number }) => {
        if (info.object) {
          setSelectedStation({ obs: info.object, x: info.x, y: info.y });
        }
      };

      if (mapZoom >= 6 && stationBarbAtlasUrl && stationBarbMapping && coverAtlasUrl && coverIconMapping) {
        layers.push(...createStationModelLayers(
          stationData, stationClick, stationBarbAtlasUrl,
          stationBarbMapping as Record<string, { x: number; y: number; width: number; height: number }>,
          coverAtlasUrl, coverIconMapping, mapZoom,
        ));
      } else {
        const dotsLayer = createStationDotsLayer(stationData, stationClick);
        if (dotsLayer) layers.push(dotsLayer);
        const labelsLayer = createStationLabelsLayer(stationData);
        if (labelsLayer) layers.push(labelsLayer);
      }
    }

    overlayRef.current.setProps({ layers });
  }, [windData, windVisible, mapZoom, atlasUrl, stationBarbAtlasUrl, coverAtlasUrl, coverIconMapping, iconMapping, handleWindHover, temperatureContours, temperatureVisible, heightContours, heightVisible, humidityContours, humidityVisible, stationData, stationVisible, tropopauseContours, tropopauseVisible, maxWindContours, maxWindVisible, maxWindBarbs, jetBarbAtlasUrl, sigwxFeatures, sigwxVisible, sigwxAtlas]);

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
      <MapLegend />
    </>
  );
}
