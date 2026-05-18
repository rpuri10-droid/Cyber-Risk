import { useEffect, useMemo, useState } from 'react';
import Papa from 'papaparse';

const topPortsToShow = 6;
const topAttackTypesToShow = 5;

function normalizeRow(row) {
  return {
    ...row,
    label: Number(row.label),
    bytes_sent: Number(row.bytes_sent || 0),
    bytes_received: Number(row.bytes_received || 0),
    src_port: Number(row.src_port || 0),
    dst_port: Number(row.dst_port || 0),
    is_internal_traffic: String(row.is_internal_traffic).toLowerCase() === 'true',
  };
}

function groupBy(items, keySelector) {
  return items.reduce((accumulator, item) => {
    const key = keySelector(item) || 'unknown';
    accumulator.set(key, (accumulator.get(key) || 0) + 1);
    return accumulator;
  }, new Map());
}

function sortMapDescending(map) {
  return [...map.entries()].sort((left, right) => right[1] - left[1]);
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatBytes(value) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} MB`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)} KB`;
  return `${Math.round(value)} B`;
}

function formatPercent(value) {
  return `${value.toFixed(1)}%`;
}

function App() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedMetric, setSelectedMetric] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      try {
        const response = await fetch('/data/cybersecurity.csv');
        if (!response.ok) {
          throw new Error(`Unable to load dataset: ${response.status}`);
        }

        const csvText = await response.text();
        const parsed = Papa.parse(csvText, {
          header: true,
          skipEmptyLines: true,
        });

        if (parsed.errors.length > 0) {
          throw new Error(parsed.errors[0].message);
        }

        const normalized = parsed.data.map(normalizeRow);

        if (!cancelled) {
          setRows(normalized);
          setLoading(false);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError.message || 'Failed to load dataset');
          setLoading(false);
        }
      }
    }

    loadData();

    return () => {
      cancelled = true;
    };
  }, []);

  const metrics = useMemo(() => {
    if (rows.length === 0) {
      return null;
    }

    const attacks = rows.filter((row) => row.label === 1);
    const benign = rows.length - attacks.length;
    const internalTraffic = rows.filter((row) => row.is_internal_traffic).length;
    const totalBytesSent = rows.reduce((sum, row) => sum + row.bytes_sent, 0);
    const totalBytesReceived = rows.reduce((sum, row) => sum + row.bytes_received, 0);
    const attackTypes = sortMapDescending(groupBy(attacks, (row) => row.attack_type));
    const protocols = sortMapDescending(groupBy(rows, (row) => row.protocol));
    const ports = sortMapDescending(groupBy(rows, (row) => String(row.dst_port)));
    const suspiciousTraffic = attacks
      .slice()
      .sort((left, right) => right.bytes_sent + right.bytes_received - (left.bytes_sent + left.bytes_received))
      .slice(0, 8);
    const attackRate = attacks.length / rows.length;
    const internalRate = internalTraffic / rows.length;
    const concentration = attackTypes.length > 0 ? attackTypes[0][1] / attacks.length : 0;
    const threatPressure = Math.min(100, Math.round(attackRate * 700 + internalRate * 80 + concentration * 140));

    const totalByDay = groupBy(rows, (row) => row.timestamp.slice(0, 10));
    const attackByDay = groupBy(attacks, (row) => row.timestamp.slice(0, 10));
    const days = [...new Set(rows.map((row) => row.timestamp.slice(0, 10)))].sort();
    const trend = days.map((day) => ({
      day,
      total: totalByDay.get(day) || 0,
      attacks: attackByDay.get(day) || 0,
    }));

    return {
      totalEvents: rows.length,
      attackEvents: attacks.length,
      benignEvents: benign,
      internalTraffic,
      attackRate,
      internalRate,
      totalBytesSent,
      totalBytesReceived,
      threatPressure,
      attackTypes,
      protocols,
      ports,
      suspiciousTraffic,
      trend,
      topAttack: attackTypes[0]?.[0] || 'unknown',
      topAttackCount: attackTypes[0]?.[1] || 0,
    };
  }, [rows]);

  const attackBars = useMemo(() => {
    if (!metrics) return [];
    const maxCount = Math.max(...metrics.attackTypes.map(([, count]) => count), 1);
    return metrics.attackTypes.slice(0, topAttackTypesToShow).map(([name, count]) => ({
      name,
      count,
      width: Math.max(10, (count / maxCount) * 100),
    }));
  }, [metrics]);

  const protocolBars = useMemo(() => {
    if (!metrics) return [];
    const maxCount = Math.max(...metrics.protocols.map(([, count]) => count), 1);
    return metrics.protocols.map(([name, count]) => ({
      name,
      count,
      width: Math.max(10, (count / maxCount) * 100),
    }));
  }, [metrics]);

  if (loading) {
    return <div className="app-shell loading-state">Loading dataset-driven dashboard...</div>;
  }

  if (error) {
    return (
      <div className="app-shell error-state">
        <h1>Dataset load failed</h1>
        <p>{error}</p>
        <p>Expected file: <code>/public/data/cybersecurity.csv</code></p>
      </div>
    );
  }

  if (!metrics) {
    return <div className="app-shell loading-state">No data available.</div>;
  }

  const handleMetricClick = (metricType, value) => {
    setSelectedMetric({ type: metricType, value });
  };

  const getFilteredRows = () => {
    if (!selectedMetric) return [];
    const { type, value } = selectedMetric;
    
    switch (type) {
      case 'attacks':
        return rows.filter(row => row.label === 1).slice(0, 20);
      case 'benign':
        return rows.filter(row => row.label === 0).slice(0, 20);
      case 'internal':
        return rows.filter(row => row.is_internal_traffic).slice(0, 20);
      case 'attackType':
        return rows.filter(row => row.attack_type === value).slice(0, 20);
      default:
        return [];
    }
  };

  const getDetailTitle = () => {
    if (!selectedMetric) return '';
    const { type, value } = selectedMetric;
    
    switch (type) {
      case 'attacks':
        return 'All Attack Events';
      case 'benign':
        return 'All Benign Events';
      case 'internal':
        return 'Internal Traffic';
      case 'attackType':
        return `${value} Attacks`;
      default:
        return 'Details';
    }
  };

  const DetailModal = () => {
    const filteredRows = getFilteredRows();
    
    return (
      <div className="modal-overlay" onClick={() => setSelectedMetric(null)}>
        <div className="modal-content" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h2>{getDetailTitle()}</h2>
            <button className="modal-close" onClick={() => setSelectedMetric(null)}>✕</button>
          </div>
          <div className="modal-body">
            <p className="modal-count">Showing {filteredRows.length} of {getFilteredRows().length} records</p>
            <div className="modal-table-wrap">
              <table className="modal-table">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Source IP</th>
                    <th>Dest IP</th>
                    <th>Protocol</th>
                    <th>Attack Type</th>
                    <th>Bytes</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row, idx) => (
                    <tr key={idx}>
                      <td>{row.timestamp}</td>
                      <td>{row.src_ip}</td>
                      <td>{row.dst_ip}</td>
                      <td>{row.protocol}</td>
                      <td>{row.attack_type}</td>
                      <td>{formatBytes(row.bytes_sent + row.bytes_received)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      <main className="app-shell">
      <section className="hero panel">
        <div className="hero-copy">
          <div className="hero-meta">
            <span className="meta-chip live">Live React</span>
            <span className="meta-chip">CSV-driven</span>
            <span className="meta-chip">10,000 events</span>
          </div>
          <p className="eyebrow">Cyber Risk Quantification</p>
          <h1>See attack pressure from real traffic data.</h1>
          <p className="lede">
            This React dashboard reads <strong>cybersecurity.csv</strong> and turns it into executive-ready
            metrics, attack patterns, and suspicious samples.
          </p>
        </div>

        <div className="hero-stats">
          <article className="stat-card accent">
            <span className="stat-label">Threat pressure index</span>
            <strong>{metrics.threatPressure}</strong>
            <small>{metrics.attackRate * 100 >= 5 ? 'Elevated' : 'Contained'} attack concentration</small>
          </article>
          <article className="stat-card">
            <span className="stat-label">Primary attack type</span>
            <strong>{metrics.topAttack}</strong>
            <small>{formatNumber(metrics.topAttackCount)} attack events</small>
          </article>
        </div>
      </section>

      <section className="grid stats-grid">
        <article className="metric-card panel" onClick={() => handleMetricClick('total')} style={{ cursor: 'pointer' }}>
          <span className="stat-label">Total events</span>
          <strong>{formatNumber(metrics.totalEvents)}</strong>
          <small>{formatPercent(metrics.attackRate * 100)} malicious traffic</small>
        </article>
        <article className="metric-card panel" onClick={() => handleMetricClick('attacks')} style={{ cursor: 'pointer' }}>
          <span className="stat-label">Attack events</span>
          <strong>{formatNumber(metrics.attackEvents)}</strong>
          <small>{formatNumber(metrics.benignEvents)} benign records</small>
        </article>
        <article className="metric-card panel" onClick={() => handleMetricClick('internal')} style={{ cursor: 'pointer' }}>
          <span className="stat-label">Internal traffic</span>
          <strong>{formatNumber(metrics.internalTraffic)}</strong>
          <small>{formatPercent(metrics.internalRate * 100)} of all rows</small>
        </article>
        <article className="metric-card panel" onClick={() => handleMetricClick('benign')} style={{ cursor: 'pointer' }}>
          <span className="stat-label">Data volume</span>
          <strong>{formatBytes(metrics.totalBytesSent + metrics.totalBytesReceived)}</strong>
          <small>Sent + received bytes</small>
        </article>
      </section>

      <section className="grid content-grid">
        <article className="panel section-card">
          <div className="panel-head">
            <h2>Attack Mix</h2>
            <span className="muted">Top attack types from CSV</span>
          </div>
          <div className="bar-list">
            {attackBars.map((bar) => (
              <div key={bar.name} className="bar-row" onClick={() => handleMetricClick('attackType', bar.name)} style={{ cursor: 'pointer' }}>
                <div className="bar-labels">
                  <span>{bar.name}</span>
                  <span>{formatNumber(bar.count)}</span>
                </div>
                <div className="bar-track">
                  <span className="bar-fill attack" style={{ width: `${bar.width}%` }} />
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="panel section-card">
          <div className="panel-head">
            <h2>Protocol Profile</h2>
            <span className="muted">Traffic by transport</span>
          </div>
          <div className="bar-list">
            {protocolBars.map((bar) => (
              <div key={bar.name} className="bar-row">
                <div className="bar-labels">
                  <span>{bar.name}</span>
                  <span>{formatNumber(bar.count)}</span>
                </div>
                <div className="bar-track">
                  <span className="bar-fill protocol" style={{ width: `${bar.width}%` }} />
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="grid bottom-grid">
        <article className="panel section-card">
          <div className="panel-head">
            <h2>Attack Trend</h2>
            <span className="muted">By day</span>
          </div>
          <div className="trend-chart">
            {metrics.trend.map((point) => {
              const attackHeight = Math.max(10, (point.attacks / Math.max(...metrics.trend.map((entry) => entry.attacks), 1)) * 100);
              const totalHeight = Math.max(12, (point.total / Math.max(...metrics.trend.map((entry) => entry.total), 1)) * 100);
              return (
                <div key={point.day} className="trend-column">
                  <div className="trend-bars">
                    <span className="trend-total" style={{ height: `${totalHeight}%` }} />
                    <span className="trend-attack" style={{ height: `${attackHeight}%` }} />
                  </div>
                  <span className="trend-label">{point.day.slice(5)}</span>
                </div>
              );
            })}
          </div>
        </article>

        <article className="panel section-card ai-panel">
          <div className="panel-head">
            <h2>Analyst Summary</h2>
            <span className="pill">React AI style</span>
          </div>
          <p className="ai-lede">
            The dataset is dominated by benign traffic, but the attack mix is concentrated in {metrics.topAttack}.
            {metrics.topAttack === 'port-scan' ? ' That usually means recon activity is the clearest early-warning signal.' : ' Focus on the highest-frequency attack family and the ports it touches.'}
          </p>
          <div className="ai-result-grid">
            <div className="ai-result-card">
              <span className="ai-label">Primary risk</span>
              <strong>{metrics.topAttack}</strong>
            </div>
            <div className="ai-result-card">
              <span className="ai-label">Recommendation</span>
              <strong>Tighten monitoring on {metrics.topAttack === 'port-scan' ? 'scan-heavy destinations' : 'attack-heavy ports'}.</strong>
            </div>
          </div>
          <div className="ai-steps">
            <div className="ai-step">
              <span className="ai-step-number">1</span>
              <p>Prioritize detections around {metrics.topAttack} because it is the most frequent attack label in the CSV.</p>
            </div>
            <div className="ai-step">
              <span className="ai-step-number">2</span>
              <p>Validate protocol baselines, especially {metrics.protocols[0]?.[0] || 'TCP'}, which carries most of the traffic volume.</p>
            </div>
            <div className="ai-step">
              <span className="ai-step-number">3</span>
              <p>Use the suspicious samples list to show concrete examples of malicious rows during the presentation.</p>
            </div>
          </div>
        </article>
      </section>

      <section className="grid table-grid">
        <article className="panel section-card full-width">
          <div className="panel-head">
            <h2>Suspicious Samples</h2>
            <span className="muted">Top attack rows by traffic volume</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Source</th>
                  <th>Destination</th>
                  <th>Protocol</th>
                  <th>Attack</th>
                  <th>Bytes</th>
                  <th>URL</th>
                </tr>
              </thead>
              <tbody>
                {metrics.suspiciousTraffic.map((row, index) => (
                  <tr key={`${row.timestamp}-${index}`}>
                    <td>{row.timestamp}</td>
                    <td>{row.src_ip}</td>
                    <td>{row.dst_ip}</td>
                    <td>{row.protocol}</td>
                    <td>{row.attack_type}</td>
                    <td>{formatBytes(row.bytes_sent + row.bytes_received)}</td>
                    <td>{row.url || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    </main>
    {selectedMetric && <DetailModal />}
    </>
  );
}

export default App;