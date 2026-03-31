import { useEffect, useState } from 'react';
import { useAppStore } from './stores/appStore';
import HeaderBar from './components/HeaderBar';
import DataPanel from './components/DataPanel';
import LayerPanel from './components/LayerPanel';
import OpmetPanel from './components/OpmetPanel';
import StatusBar from './components/StatusBar';
import MapView from './components/map/MapView';
import './App.css';

export default function App() {
  const fetchMeta = useAppStore((s) => s.fetchMeta);
  const [dataCollapsed, setDataCollapsed] = useState(false);
  const [layerCollapsed, setLayerCollapsed] = useState(false);
  const [opmetVisible, setOpmetVisible] = useState(false);

  useEffect(() => {
    fetchMeta();
  }, []);

  return (
    <div className="app">
      <HeaderBar onOpmetToggle={() => setOpmetVisible(!opmetVisible)} opmetActive={opmetVisible} />
      <div className="workstation">
        <DataPanel
          collapsed={dataCollapsed}
          onToggle={() => setDataCollapsed(!dataCollapsed)}
        />
        <main className="map-main">
          <div className="map-container">
            <MapView />
          </div>
          <OpmetPanel visible={opmetVisible} onClose={() => setOpmetVisible(false)} />
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
