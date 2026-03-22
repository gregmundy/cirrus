import { useEffect } from 'react';
import { useAppStore } from './stores/appStore';
import Toolbar from './components/Toolbar';
import StatusBar from './components/StatusBar';
import MapView from './components/map/MapView';
import './App.css';

export default function App() {
  const fetchMeta = useAppStore((s) => s.fetchMeta);

  useEffect(() => {
    fetchMeta();
  }, []);

  return (
    <div className="app">
      <Toolbar />
      <div className="map-container">
        <MapView />
      </div>
      <StatusBar />
    </div>
  );
}
