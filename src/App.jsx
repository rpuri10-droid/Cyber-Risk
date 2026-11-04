import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Papa from 'papaparse';
import {
  ATTACK_PROFILES,
  EMPTY_FILTERS,
  activeFilterCount,
  applyFilters,
  computeMetrics,
  datasetSpan,
  formatBytes,
  formatDay,
  formatNumber,
  formatPercent,
  formatUsdCompact,
  normalizeRow,
  profileFor,
  serviceName,
} from './lib/analytics';
import { BarList, Heatmap, HourStrip, ScoreGauge, TrendChart } from './components/Charts';
import RiskQuantification from './components/RiskQuantification';
import EventExplorer from './components/EventExplorer';

const DATA_URL = `${import.meta.env.BASE_URL}data/cybersecurity.csv`;
const REQUIRED_COLUMNS = ['timestamp', 'src_ip', 'dst_ip', 'dst_port', 'protocol', 'label', 'attack_type'];
const STORAGE_KEY = 'cyber-risk-assumptions-v1';

const DEFAULT_ASSUMPTIONS = {
  controlEffectiveness: 0.6,
  lossPerEvent: Object.fromEntries(Object.entries(ATTACK_PROFILES).map(([type, p]) => [type, p.lossPerEvent])),
};

function loadAssumptions() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && typeof saved.controlEffectiveness === 'number') {
      return { ...DEFAULT_ASSUMPTIONS, ...saved, lossPerEvent: { ...DEFAULT_ASSUMPTIONS.lossPerEvent, ...saved.lossPerEvent } };
    }
  } catch {
    // storage unavailable or corrupt: fall back to defaults
  }
  return DEFAULT_ASSUMPTIONS;
}

function parseCsv(input) {
  return new Promise((resolve, reject) => {
    Papa.parse(input, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const fields = result.meta.fields || [];
        const missing = REQUIRED_COLUMNS.filter((column) => !fields.includes(column));
        if (missing.length) {
          reject(new Error(`CSV is missing required column(s): ${missing.join(', ')}`));
          return;
        }
        const rows = result.data.filter((row) => row.timestamp).map(normalizeRow);
        if (rows.length === 0) {
          reject(new Error('CSV contained no usable rows.'));
          return;
        }
        resolve({ rows, skipped: result.errors.length });
      },
      error: (error) => reject(error),
    });
  });
}

function describeFilters(filters) {
  const parts = [];
  if (filters.from || filters.to) parts.push(`${filters.from ? formatDay(filters.from) : 'start'} – ${filters.to ? formatDay(filters.to) : 'end'}`);
  if (filters.scope !== 'all') parts.push(`${filters.scope} traffic`);
  if (filters.protocol !== 'all') parts.push(filters.protocol);
  if (filters.attackType === 'attacks') parts.push('attacks only');
  else if (filters.attackType === 'benign') parts.push('benign only');
  else if (filters.attackType !== 'all') parts.push(profileFor(filters.attackType).label);
  if (filters.port !== 'all') parts.push(`port ${serviceName(Number(filters.port))}`);
  if (filters.agent !== 'all') parts.push(filters.agent);
  if (filters.search.trim()) parts.push(`“${filters.search.trim()}”`);
  return parts.length ? parts.join(' · ') : 'all traffic';
}

function buildFindings(metrics) {
  const findings = [];
  const top = metrics.byAle[0];
  if (top) {
    findings.push({
      tone: 'high',
      title: `${top.label} drives the most loss exposure`,
      body: `${formatUsdCompact(top.inherentAle)} per year inherent (${formatPercent(top.inherentAle / (metrics.inherentAle || 1), 0)} of total), from ${top.count} observed attempts. Prioritize detections and controls for this family first.`,
    });
  }

  const riskyPort = metrics.ports.filter((p) => p.total >= 50).sort((a, b) => b.rate - a.rate)[0];
  if (riskyPort && riskyPort.attacks > 0) {
    findings.push({
      tone: 'moderate',
      title: `${serviceName(riskyPort.key)} has the highest attack rate`,
      body: `${formatPercent(riskyPort.rate)} of traffic to this port is malicious (${riskyPort.attacks} of ${formatNumber(riskyPort.total)} events) vs ${formatPercent(metrics.attackRate)} overall. Review exposure and access rules for this service.`,
    });
  }

  const browserRate = (() => {
    const browsers = metrics.agents.filter((a) => a.key.includes('browser'));
    const total = browsers.reduce((s, a) => s + a.total, 0);
    return total ? browsers.reduce((s, a) => s + a.attacks, 0) / total : 0;
  })();
  if (metrics.automated > 0 && metrics.automatedAttacks > 0) {
    const lift = browserRate ? metrics.automatedAttackRate / browserRate : 0;
    const scanner = metrics.agents.find((a) => a.key === 'sqlmap' || a.key === 'zgrab');
    findings.push({
      tone: 'moderate',
      title: 'Automated clients are disproportionately hostile',
      body: `${formatPercent(metrics.automatedAttackRate)} of curl / script / scanner traffic is malicious${lift ? ` — ${lift.toFixed(1)}× the browser rate` : ''}.${scanner ? ` Known attack tooling (${scanner.key}) appears in ${formatNumber(scanner.total)} events; consider blocking these user agents at the edge.` : ''}`,
    });
  }

  if (metrics.momentum) {
    const { change, recent, prior } = metrics.momentum;
    findings.push({
      tone: change > 0.15 ? 'high' : change < -0.15 ? 'low' : 'moderate',
      title: `Attack rate ${change >= 0 ? 'rising' : 'falling'} over the last two weeks`,
      body: `${formatPercent(recent.rate)} in the latest 14 days vs ${formatPercent(prior.rate)} in the 14 days before (${change >= 0 ? '+' : ''}${(change * 100).toFixed(0)}%).`,
    });
  }

  const peak = [...metrics.hours].sort((a, b) => b.attacks - a.attacks)[0];
  if (peak && peak.attacks > 0) {
    findings.push({
      tone: 'low',
      title: `Peak attack hour: ${String(peak.hour).padStart(2, '0')}:00 UTC`,
      body: `${peak.attacks} attacks fall in this hour. Make sure on-call coverage and alert routing match it.`,
    });
  }
  return findings;
}

export default function App() {
  const [allRows, setAllRows] = useState([]);
  const [source, setSource] = useState('cybersecurity.csv');
  const [status, setStatus] = useState({ loading: true, error: '', notice: '' });
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [assumptions, setAssumptions] = useState(loadAssumptions);
  const fileInput = useRef(null);

  useEffect(() => {
    let cancelled = false;
    fetch(DATA_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`Unable to load dataset (HTTP ${response.status})`);
        return response.text();
      })
      .then(parseCsv)
      .then(({ rows, skipped }) => {
        if (cancelled) return;
        setAllRows(rows);
        setStatus({ loading: false, error: '', notice: skipped ? `${skipped} malformed rows skipped.` : '' });
      })
      .catch((error) => {
        if (!cancelled) setStatus({ loading: false, error: error.message || 'Failed to load dataset', notice: '' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(assumptions));
    } catch {
      // ignore storage failures
    }
  }, [assumptions]);

  const handleUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setStatus((current) => ({ ...current, notice: `Loading ${file.name}…` }));
    try {
      const { rows, skipped } = await parseCsv(file);
      setAllRows(rows);
      setSource(file.name);
      setFilters(EMPTY_FILTERS);
      setStatus({ loading: false, error: '', notice: `Loaded ${formatNumber(rows.length)} events from ${file.name}.${skipped ? ` ${skipped} malformed rows skipped.` : ''}` });
    } catch (error) {
      setStatus((current) => ({ ...current, notice: `Could not load ${file.name}: ${error.message}` }));
    }
  };

  const fullSpan = useMemo(() => datasetSpan(allRows), [allRows]);
  const rows = useMemo(() => applyFilters(allRows, filters), [allRows, filters]);
  const metrics = useMemo(() => computeMetrics(rows, assumptions), [rows, assumptions]);
  const findings = useMemo(() => buildFindings(metrics), [metrics]);

  const options = useMemo(
    () => ({
      protocols: [...new Set(allRows.map((r) => r.protocol))].sort(),
      attackTypes: [...new Set(allRows.filter((r) => r.label).map((r) => r.attack_type))].sort(),
      ports: commonPorts(allRows),
      agents: [...new Set(allRows.map((r) => r.agent))].sort(),
    }),
    [allRows],
  );

  const setFilter = useCallback((key, value) => setFilters((current) => ({ ...current, [key]: value })), []);
  const toggleFilter = useCallback(
    (key, value) => setFilters((current) => ({ ...current, [key]: current[key] === value ? EMPTY_FILTERS[key] : value })),
    [],
  );
  const focusExplorer = () => document.getElementById('explorer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  if (status.loading) {
    return (
      <div className="app-shell state-screen">
        <span className="spinner" aria-hidden="true" />
        <p>Loading traffic dataset…</p>
      </div>
    );
  }

  if (status.error) {
    return (
      <div className="app-shell state-screen">
        <h1>Dataset load failed</h1>
        <p>{status.error}</p>
        <p className="muted">
          Expected file: <code>public/data/cybersecurity.csv</code>, or load one manually:
        </p>
        <input type="file" accept=".csv,text/csv" onChange={handleUpload} />
        {status.notice && <p className="muted">{status.notice}</p>}
      </div>
    );
  }

  const filterCount = activeFilterCount(filters);
  const filterSummary = describeFilters(filters);

  const kpis = [
    {
      key: 'events',
      label: 'Events in view',
      value: formatNumber(metrics.total),
      note: `${formatDay(metrics.span.first)} – ${formatDay(metrics.span.last)} · ${metrics.span.days} days`,
      onClick: () => {
        setFilters(EMPTY_FILTERS);
      },
      action: 'Clear filters',
    },
    {
      key: 'attacks',
      label: 'Attack events',
      value: formatNumber(metrics.attacks),
      note: `${formatPercent(metrics.attackRate)} of traffic is malicious`,
      onClick: () => {
        toggleFilter('attackType', 'attacks');
        focusExplorer();
      },
      active: filters.attackType === 'attacks',
      action: 'Show attacks only',
      tone: 'alert',
    },
    {
      key: 'internal',
      label: 'Internal traffic',
      value: formatNumber(metrics.internal),
      note: `${formatPercent(metrics.internalRate)} of events`,
      onClick: () => {
        toggleFilter('scope', 'internal');
        focusExplorer();
      },
      active: filters.scope === 'internal',
      action: 'Show internal only',
    },
    {
      key: 'automated',
      label: 'Automated clients',
      value: formatNumber(metrics.automated),
      note: `${formatPercent(metrics.automatedAttackRate)} of them malicious`,
      action: 'curl, scripts and scanners',
    },
    {
      key: 'volume',
      label: 'Data volume',
      value: formatBytes(metrics.totalBytes),
      note: 'Sent + received',
    },
  ];

  return (
    <main className="app-shell">
      <header className="hero panel">
        <div className="hero-copy">
          <div className="hero-meta">
            <span className="meta-chip live">{source}</span>
            <span className="meta-chip">{formatNumber(allRows.length)} events</span>
            <span className="meta-chip">
              {formatDay(fullSpan.first)} – {formatDay(fullSpan.last)}
            </span>
          </div>
          <p className="eyebrow">Cyber Risk Quantification</p>
          <h1>Attack pressure, priced in dollars.</h1>
          <p className="lede">
            Network events from <strong>{source}</strong> turned into a transparent risk score, an annualized loss
            estimate you can tune, and drill-downs to the rows behind every number.
          </p>
          <div className="hero-actions">
            <button type="button" className="primary-button" onClick={() => fileInput.current?.click()}>
              Load another CSV
            </button>
            <input ref={fileInput} type="file" accept=".csv,text/csv" hidden onChange={handleUpload} />
            {status.notice && <span className="muted small">{status.notice}</span>}
          </div>
        </div>

        <div className="score-card">
          <div className="score-top">
            <div>
              <span className="stat-label">Composite risk score</span>
              <p className="muted small">{filterCount ? `For: ${filterSummary}` : 'All traffic'}</p>
            </div>
            <ScoreGauge score={metrics.riskScore} band={metrics.band} />
          </div>
          <ul className="score-breakdown">
            {metrics.components.map((component) => (
              <li key={component.key} title={component.detail}>
                <span className="breakdown-label">
                  <span>{component.label}</span>
                  <span className="mono">
                    {component.points.toFixed(0)}/{component.weight}
                  </span>
                </span>
                <span className="breakdown-track" aria-hidden="true">
                  <span className="breakdown-fill" style={{ width: `${component.value * 100}%` }} />
                </span>
                <span className="muted small">{component.detail}</span>
              </li>
            ))}
          </ul>
          <div className="score-ale">
            <span className="stat-label">Residual annual loss exposure</span>
            <strong>{formatUsdCompact(metrics.residualAle)}</strong>
            <span className="muted small">
              of {formatUsdCompact(metrics.inherentAle)} inherent at {Math.round(assumptions.controlEffectiveness * 100)}% control
              effectiveness
            </span>
          </div>
        </div>
      </header>

      <section className="panel filter-bar" aria-label="Filters">
        <label>
          <span>From</span>
          <input
            type="date"
            value={filters.from}
            min={fullSpan.first}
            max={filters.to || fullSpan.last}
            onChange={(e) => setFilter('from', e.target.value)}
          />
        </label>
        <label>
          <span>To</span>
          <input
            type="date"
            value={filters.to}
            min={filters.from || fullSpan.first}
            max={fullSpan.last}
            onChange={(e) => setFilter('to', e.target.value)}
          />
        </label>
        <label>
          <span>Traffic</span>
          <select value={filters.scope} onChange={(e) => setFilter('scope', e.target.value)}>
            <option value="all">All</option>
            <option value="internal">Internal</option>
            <option value="external">External</option>
          </select>
        </label>
        <label>
          <span>Classification</span>
          <select value={filters.attackType} onChange={(e) => setFilter('attackType', e.target.value)}>
            <option value="all">All events</option>
            <option value="attacks">Attacks only</option>
            <option value="benign">Benign only</option>
            {options.attackTypes.map((type) => (
              <option key={type} value={type}>
                {profileFor(type).label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Protocol</span>
          <select value={filters.protocol} onChange={(e) => setFilter('protocol', e.target.value)}>
            <option value="all">All</option>
            {options.protocols.map((protocol) => (
              <option key={protocol}>{protocol}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Port</span>
          <select value={filters.port} onChange={(e) => setFilter('port', e.target.value)}>
            <option value="all">All</option>
            {options.ports.map((port) => (
              <option key={port} value={String(port)}>
                {serviceName(port)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Client</span>
          <select value={filters.agent} onChange={(e) => setFilter('agent', e.target.value)}>
            <option value="all">All</option>
            {options.agents.map((agent) => (
              <option key={agent}>{agent}</option>
            ))}
          </select>
        </label>
        <label className="search">
          <span>Search IP / URL / user agent</span>
          <input
            type="search"
            placeholder="e.g. 10.0. or phpmyadmin"
            value={filters.search}
            onChange={(e) => setFilter('search', e.target.value)}
          />
        </label>
        <button type="button" className="ghost-button" onClick={() => setFilters(EMPTY_FILTERS)} disabled={!filterCount}>
          Reset{filterCount ? ` (${filterCount})` : ''}
        </button>
      </section>

      <section className="stats-grid" aria-label="Key metrics">
        {kpis.map((kpi) => {
          const body = (
            <>
              <span className="stat-label">{kpi.label}</span>
              <strong>{kpi.value}</strong>
              <small>{kpi.note}</small>
              {kpi.action && <span className="kpi-action">{kpi.action}</span>}
            </>
          );
          return kpi.onClick ? (
            <button
              key={kpi.key}
              type="button"
              className={`metric-card panel interactive${kpi.active ? ' selected' : ''}${kpi.tone ? ` tone-${kpi.tone}` : ''}`}
              onClick={kpi.onClick}
              aria-pressed={kpi.active ?? undefined}
            >
              {body}
            </button>
          ) : (
            <div key={kpi.key} className="metric-card panel">
              {body}
            </div>
          );
        })}
      </section>

      <section className="grid two-col">
        <RiskQuantification
          metrics={metrics}
          assumptions={assumptions}
          onLossChange={(type, value) =>
            setAssumptions((current) => ({ ...current, lossPerEvent: { ...current.lossPerEvent, [type]: value } }))
          }
          onControlChange={(value) => setAssumptions((current) => ({ ...current, controlEffectiveness: value }))}
          onReset={() => setAssumptions(DEFAULT_ASSUMPTIONS)}
        />

        <article className="panel section-card findings-panel" aria-labelledby="findings-title">
          <div className="panel-head">
            <h2 id="findings-title">Key Findings</h2>
            <span className="muted small">Computed from the current view</span>
          </div>
          {findings.length === 0 ? (
            <p className="empty">No attacks in the current view.</p>
          ) : (
            <ol className="findings">
              {findings.map((finding) => (
                <li key={finding.title} className={`finding tone-${finding.tone}`}>
                  <strong>{finding.title}</strong>
                  <p>{finding.body}</p>
                </li>
              ))}
            </ol>
          )}
        </article>
      </section>

      <section className="grid two-col">
        <article className="panel section-card" aria-labelledby="trend-title">
          <div className="panel-head">
            <h2 id="trend-title">Attack Trend</h2>
            <span className="muted small">Weekly</span>
          </div>
          <TrendChart trend={metrics.trend} span={metrics.span} />
        </article>

        <article className="panel section-card" aria-labelledby="mix-title">
          <div className="panel-head">
            <h2 id="mix-title">Attack Mix</h2>
            <span className="muted small">Click to filter</span>
          </div>
          {metrics.attackTypes.length === 0 ? (
            <p className="empty">No attacks in the current view.</p>
          ) : (
            <BarList
              items={metrics.attackTypes.map((item) => ({ key: item.type, label: item.label, value: item.count, item }))}
              selectedKey={filters.attackType}
              onSelect={(type) => toggleFilter('attackType', type)}
              renderMeta={({ item }) => `S${item.severity}`}
            />
          )}
          <div className="sub-section">
            <h3>Attacks by hour (UTC)</h3>
            <HourStrip hours={metrics.hours} />
          </div>
        </article>
      </section>

      <section className="grid wide-left">
        <article className="panel section-card" aria-labelledby="heat-title">
          <div className="panel-head">
            <h2 id="heat-title">Targeted Services</h2>
            <span className="muted small">Attack type × destination port · click a cell to drill in</span>
          </div>
          <Heatmap
            heatmap={metrics.heatmap}
            labelForType={(type) => profileFor(type).label}
            labelForPort={serviceName}
            onSelect={(type, port) => {
              setFilters((current) => ({ ...current, attackType: type, port: String(port) }));
              focusExplorer();
            }}
          />
        </article>

        <article className="panel section-card" aria-labelledby="clients-title">
          <div className="panel-head">
            <h2 id="clients-title">Clients &amp; Protocols</h2>
            <span className="muted small">Attack rate per group</span>
          </div>
          <BarList
            tone="protocol"
            items={metrics.agents.map((agent) => ({ key: agent.key, label: agent.key, value: agent.total, agent }))}
            selectedKey={filters.agent}
            onSelect={(agent) => toggleFilter('agent', agent)}
            renderMeta={({ agent }) => formatPercent(agent.rate)}
          />
          <div className="sub-section">
            <BarList
              tone="protocol"
              items={metrics.protocols.map((p) => ({ key: p.key, label: p.key, value: p.total, p }))}
              selectedKey={filters.protocol}
              onSelect={(protocol) => toggleFilter('protocol', protocol)}
              renderMeta={({ p }) => formatPercent(p.rate)}
            />
          </div>
        </article>
      </section>

      <EventExplorer rows={rows} filterSummary={filterSummary} />

      <footer className="page-footer muted small">
        Scores and dollar figures are model outputs driven by the assumptions above — use them to compare and
        prioritize, not as audited loss figures.
      </footer>
    </main>
  );
}

// Keep the port dropdown readable: well-known services plus any port with real volume.
function commonPorts(rows) {
  const counts = new Map();
  for (const row of rows) counts.set(row.dst_port, (counts.get(row.dst_port) || 0) + 1);
  return [...counts.entries()]
    .filter(([port, count]) => count >= 20 || serviceName(port) !== String(port))
    .map(([port]) => port)
    .sort((a, b) => a - b);
}
