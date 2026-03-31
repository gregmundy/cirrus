import { useEffect, useState } from 'react';
import { useAppStore } from './stores/appStore';
import HeaderBar from './components/HeaderBar';
import DataPanel from './components/DataPanel';
import LayerPanel from './components/LayerPanel';
import StatusBar from './components/StatusBar';
import MapView from './components/map/MapView';
import './App.css';

export default function App() {
  const fetchMeta = useAppStore((s) => s.fetchMeta);
  const [dataCollapsed, setDataCollapsed] = useState(false);
  const [layerCollapsed, setLayerCollapsed] = useState(false);

  useEffect(() => {
    fetchMeta();
  }, []);

  return (
    <div className="app">
      <HeaderBar />
      <div className="workstation">
        <DataPanel
          collapsed={dataCollapsed}
          onToggle={() => setDataCollapsed(!dataCollapsed)}
        />
        <main className="map-main">
          <div className="map-container">
            <MapView />
          </div>
        </main>
        <LayerPanel
          collapsed={layerCollapsed}
          onToggle={() => setLayerCollapsed(!layerCollapsed)}
        />
      </div>
      <StatusBar />
    </div>
  );
}
