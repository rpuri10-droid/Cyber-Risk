import { useEffect, useMemo, useState } from 'react';
import { formatBytes, formatNumber, profileFor, rowsToCsv, serviceName } from '../lib/analytics';

const PAGE_SIZE = 15;

const COLUMNS = [
  { key: 'timestamp', label: 'Timestamp' },
  { key: 'src_ip', label: 'Source' },
  { key: 'dst_ip', label: 'Destination' },
  { key: 'dst_port', label: 'Port', numeric: true },
  { key: 'protocol', label: 'Proto' },
  { key: 'attack_type', label: 'Classification' },
  { key: 'agent', label: 'Client' },
  { key: 'bytes', label: 'Bytes', numeric: true },
];

function compare(a, b, key) {
  const left = a[key];
  const right = b[key];
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left).localeCompare(String(right));
}

export default function EventExplorer({ rows, filterSummary }) {
  const [sort, setSort] = useState({ key: 'bytes', direction: 'desc' });
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    setPage(0);
    setExpanded(null);
  }, [rows]);

  const sorted = useMemo(() => {
    const factor = sort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => compare(a, b, sort.key) * factor);
  }, [rows, sort]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = sorted.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const toggleSort = (key) =>
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: key === 'timestamp' || key === 'bytes' ? 'desc' : 'asc' },
    );

  const exportCsv = () => {
    const blob = new Blob([rowsToCsv(sorted)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `cyber-risk-events-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <article className="panel section-card" id="explorer" aria-labelledby="explorer-title">
      <div className="panel-head">
        <div>
          <h2 id="explorer-title">Event Explorer</h2>
          <span className="muted small">
            {formatNumber(rows.length)} events · {filterSummary}
          </span>
        </div>
        <button type="button" className="ghost-button" onClick={exportCsv} disabled={rows.length === 0}>
          Export CSV
        </button>
      </div>

      <div className="table-wrap">
        <table className="explorer-table">
          <thead>
            <tr>
              {COLUMNS.map((column) => {
                const active = sort.key === column.key;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    className={column.numeric ? 'num' : undefined}
                    aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                  >
                    <button type="button" className="sort-button" onClick={() => toggleSort(column.key)}>
                      {column.label}
                      <span aria-hidden="true" className="sort-indicator">
                        {active ? (sort.direction === 'asc' ? '▲' : '▼') : '↕'}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length} className="empty">
                  No events match the current filters.
                </td>
              </tr>
            )}
            {visible.map((row) => {
              const isOpen = expanded === row.id;
              return [
                <tr
                  key={row.id}
                  className={`event-row${row.label ? ' is-attack' : ''}${isOpen ? ' open' : ''}`}
                  onClick={() => setExpanded(isOpen ? null : row.id)}
                >
                  <td className="mono">{row.timestamp}</td>
                  <td className="mono">
                    {row.src_ip}
                    {row.is_internal_traffic && <span className="tag">int</span>}
                  </td>
                  <td className="mono">{row.dst_ip}</td>
                  <td className="num mono" title={serviceName(row.dst_port)}>
                    {row.dst_port}
                  </td>
                  <td>{row.protocol}</td>
                  <td>
                    {row.label ? (
                      <span className={`sev sev-${profileFor(row.attack_type).severity}`}>{row.attack_type}</span>
                    ) : (
                      <span className="benign">benign</span>
                    )}
                  </td>
                  <td>{row.agent}</td>
                  <td className="num">{formatBytes(row.bytes)}</td>
                </tr>,
                isOpen && (
                  <tr key={`${row.id}-detail`} className="event-detail">
                    <td colSpan={COLUMNS.length}>
                      <dl>
                        <div>
                          <dt>Source port</dt>
                          <dd>{row.src_port}</dd>
                        </div>
                        <div>
                          <dt>Service</dt>
                          <dd>{serviceName(row.dst_port)}</dd>
                        </div>
                        <div>
                          <dt>Sent / received</dt>
                          <dd>
                            {formatBytes(row.bytes_sent)} / {formatBytes(row.bytes_received)}
                          </dd>
                        </div>
                        <div className="wide">
                          <dt>URL</dt>
                          <dd className="mono">{row.url || '—'}</dd>
                        </div>
                        <div className="wide">
                          <dt>User agent</dt>
                          <dd className="mono">{row.user_agent || '—'}</dd>
                        </div>
                      </dl>
                    </td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>
      </div>

      <nav className="pager" aria-label="Event pages">
        <button type="button" className="ghost-button" onClick={() => setPage(0)} disabled={safePage === 0}>
          «
        </button>
        <button type="button" className="ghost-button" onClick={() => setPage(safePage - 1)} disabled={safePage === 0}>
          Prev
        </button>
        <span className="muted small">
          Page {safePage + 1} of {pageCount}
        </span>
        <button
          type="button"
          className="ghost-button"
          onClick={() => setPage(safePage + 1)}
          disabled={safePage >= pageCount - 1}
        >
          Next
        </button>
        <button
          type="button"
          className="ghost-button"
          onClick={() => setPage(pageCount - 1)}
          disabled={safePage >= pageCount - 1}
        >
          »
        </button>
      </nav>
    </article>
  );
}
