import { useState } from 'react';

interface Workspace {
  id: string;
  name: string;
}

export default function HeaderBar() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([
    { id: 'ws-1', name: 'Analysis' },
  ]);
  const [activeWs, setActiveWs] = useState('ws-1');

  const addWorkspace = () => {
    const id = `ws-${Date.now()}`;
    const num = workspaces.length + 1;
    setWorkspaces([...workspaces, { id, name: `Workspace ${num}` }]);
    setActiveWs(id);
  };

  return (
    <header className="header-bar">
      <div className="header-brand">
        <span className="brand-icon">◈</span>
        <span className="brand-name">CIRRUS</span>
        <span className="brand-sub">WAFS</span>
      </div>

      <nav className="workspace-tabs">
        {workspaces.map((ws) => (
          <button
            key={ws.id}
            className={`ws-tab ${activeWs === ws.id ? 'active' : ''}`}
            onClick={() => setActiveWs(ws.id)}
          >
            {ws.name}
          </button>
        ))}
        <button className="ws-tab ws-add" onClick={addWorkspace} title="New workspace">
          +
        </button>
      </nav>

      <div className="header-right">
        <div className="header-clock" id="header-clock" />
        <div className="alert-indicator" title="No active alerts">
          <span className="alert-dot idle" />
          ALT
        </div>
      </div>
    </header>
  );
}
