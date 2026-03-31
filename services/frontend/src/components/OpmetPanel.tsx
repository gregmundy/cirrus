import { useState, useEffect, useCallback } from 'react';

interface OpmetReport {
  report_type: string;
  station: string | null;
  fir_name: string | null;
  issue_time: string | null;
  valid_from: string | null;
  valid_to: string | null;
  raw_text: string;
  hazard: string | null;
  qualifier: string | null;
}

type ReportFilter = 'ALL' | 'TAF' | 'SIGMET';

function formatTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${dd} ${months[d.getUTCMonth()]} ${hh}:${mm}Z`;
}

function hazardColor(hazard: string | null): string {
  switch (hazard) {
    case 'TS': return 'var(--accent-red)';
    case 'TURB': return 'var(--accent-amber)';
    case 'ICE': return 'var(--accent-purple)';
    case 'VA': return 'var(--accent-red)';
    case 'MTW': return 'var(--accent-amber)';
    default: return 'var(--text-secondary)';
  }
}

interface OpmetPanelProps {
  visible: boolean;
  onClose: () => void;
}

export default function OpmetPanel({ visible, onClose }: OpmetPanelProps) {
  const [reports, setReports] = useState<OpmetReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<ReportFilter>('ALL');
  const [stationSearch, setStationSearch] = useState('');
  const [selectedReport, setSelectedReport] = useState<OpmetReport | null>(null);

  const fetchReports = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter !== 'ALL') params.set('type', filter);
      if (stationSearch.trim()) params.set('station', stationSearch.trim().toUpperCase());
      const res = await fetch(`/api/opmet/text?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setReports(data.reports ?? []);
    } catch {
      setReports([]);
    } finally {
      setLoading(false);
    }
  }, [filter, stationSearch]);

  useEffect(() => {
    if (visible) fetchReports();
  }, [visible, fetchReports]);

  // Auto-refresh every 5 minutes
  useEffect(() => {
    if (!visible) return;
    const timer = setInterval(fetchReports, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [visible, fetchReports]);

  if (!visible) return null;

  const filteredReports = reports;

  const tafCount = reports.filter(r => r.report_type === 'TAF').length;
  const sigmetCount = reports.filter(r => r.report_type === 'SIGMET').length;

  return (
    <div className="opmet-panel">
      <div className="opmet-header">
        <span className="opmet-title">OPMET TEXT</span>
        <div className="opmet-counts">
          <span className="opmet-count">{tafCount} TAF</span>
          <span className="opmet-count">{sigmetCount} SIGMET</span>
        </div>
        <button className="opmet-close" onClick={onClose}>×</button>
      </div>

      <div className="opmet-controls">
        <div className="opmet-filters">
          {(['ALL', 'TAF', 'SIGMET'] as ReportFilter[]).map((f) => (
            <button
              key={f}
              className={`opmet-filter-btn ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>
        <input
          className="opmet-search"
          type="text"
          placeholder="ICAO / FIR..."
          value={stationSearch}
          onChange={(e) => setStationSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && fetchReports()}
        />
      </div>

      <div className="opmet-list">
        {loading && <div className="opmet-loading">Loading...</div>}
        {!loading && filteredReports.length === 0 && (
          <div className="opmet-empty">No reports found</div>
        )}
        {filteredReports.map((report, i) => (
          <div
            key={i}
            className={`opmet-row ${selectedReport === report ? 'selected' : ''}`}
            onClick={() => setSelectedReport(selectedReport === report ? null : report)}
          >
            <div className="opmet-row-header">
              <span
                className="opmet-type-badge"
                style={{
                  color: report.report_type === 'SIGMET'
                    ? hazardColor(report.hazard)
                    : 'var(--accent-cyan)',
                }}
              >
                {report.report_type}
              </span>
              <span className="opmet-station">
                {report.station ?? report.fir_name ?? '—'}
              </span>
              {report.hazard && (
                <span
                  className="opmet-hazard"
                  style={{ color: hazardColor(report.hazard) }}
                >
                  {report.qualifier ? `${report.qualifier} ` : ''}{report.hazard}
                </span>
              )}
              <span className="opmet-time">
                {report.valid_from ? formatTime(report.valid_from) : ''}
              </span>
            </div>
            {selectedReport === report && (
              <pre className="opmet-raw">{report.raw_text}</pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
