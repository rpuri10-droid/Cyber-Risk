import { DAY_MS, formatDay, formatNumber, formatPercent } from '../lib/analytics';

/** Horizontal bar list. Each row is a button when `onSelect` is provided. */
export function BarList({ items, tone = 'attack', onSelect, selectedKey, renderMeta }) {
  const max = Math.max(1, ...items.map((item) => item.value));
  return (
    <ul className="bar-list">
      {items.map((item) => {
        const content = (
          <>
            <span className="bar-labels">
              <span className="bar-name">{item.label}</span>
              <span className="bar-value">
                {formatNumber(item.value)}
                {renderMeta && <span className="bar-meta">{renderMeta(item)}</span>}
              </span>
            </span>
            <span className="bar-track" aria-hidden="true">
              <span className={`bar-fill ${tone}`} style={{ width: `${(item.value / max) * 100}%` }} />
            </span>
          </>
        );
        return (
          <li key={item.key}>
            {onSelect ? (
              <button
                type="button"
                className={`bar-row interactive${selectedKey === item.key ? ' selected' : ''}`}
                onClick={() => onSelect(item.key)}
                aria-pressed={selectedKey === item.key}
                title={`Filter dashboard to ${item.label}`}
              >
                {content}
              </button>
            ) : (
              <div className="bar-row">{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Weekly attacks (bars) with the attack rate (line) drawn in a separate band below. */
export function TrendChart({ trend, span }) {
  if (trend.length === 0) return <p className="empty">No events in range.</p>;

  const width = 640;
  const barTop = 16;
  const barHeight = 150;
  const rateTop = barTop + barHeight + 34;
  const rateHeight = 60;
  const height = rateTop + rateHeight + 26;
  const left = 34;
  const right = 8;
  const plotWidth = width - left - right;
  const step = plotWidth / trend.length;
  const barWidth = Math.max(4, step * 0.62);
  const maxAttacks = Math.max(1, ...trend.map((point) => point.attacks));
  const maxRate = Math.max(0.01, ...trend.map((point) => point.rate));
  const x = (index) => left + step * index + step / 2;
  const isPartial = (week) => {
    const start = Date.parse(week);
    return start < Date.parse(span.first) || start + 6 * DAY_MS > Date.parse(span.last);
  };
  const ratePath = trend
    .map((point, index) => {
      const y = rateTop + rateHeight - (point.rate / maxRate) * rateHeight;
      return `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const labelEvery = Math.ceil(trend.length / 7);

  return (
    <figure className="trend-figure">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Weekly attack volume and attack rate">
        <text className="axis-title" x={left} y={10}>
          Attacks per week
        </text>
        {[0, 0.5, 1].map((tick) => {
          const y = barTop + barHeight - tick * barHeight;
          return (
            <g key={tick}>
              <line className="gridline" x1={left} x2={width - right} y1={y} y2={y} />
              <text className="axis-label" x={left - 6} y={y + 4} textAnchor="end">
                {Math.round(tick * maxAttacks)}
              </text>
            </g>
          );
        })}
        {trend.map((point, index) => {
          const h = (point.attacks / maxAttacks) * barHeight;
          return (
            <rect
              key={point.week}
              className={`trend-bar${isPartial(point.week) ? ' partial' : ''}`}
              x={x(index) - barWidth / 2}
              y={barTop + barHeight - h}
              width={barWidth}
              height={Math.max(h, 1)}
              rx={3}
            >
              <title>
                {`Week of ${formatDay(point.week)}: ${point.attacks} attacks / ${formatNumber(point.total)} events (${formatPercent(point.rate)})${isPartial(point.week) ? ' — partial week' : ''}`}
              </title>
            </rect>
          );
        })}

        <text className="axis-title" x={left} y={rateTop - 10}>
          Attack rate
        </text>
        <line className="gridline" x1={left} x2={width - right} y1={rateTop + rateHeight} y2={rateTop + rateHeight} />
        <line className="gridline" x1={left} x2={width - right} y1={rateTop} y2={rateTop} />
        <text className="axis-label" x={left - 6} y={rateTop + 4} textAnchor="end">
          {formatPercent(maxRate, 0)}
        </text>
        <text className="axis-label" x={left - 6} y={rateTop + rateHeight + 4} textAnchor="end">
          0%
        </text>
        <path className="rate-line" d={ratePath} />
        {trend.map((point, index) => (
          <circle
            key={point.week}
            className="rate-dot"
            cx={x(index)}
            cy={rateTop + rateHeight - (point.rate / maxRate) * rateHeight}
            r={3}
          >
            <title>{`Week of ${formatDay(point.week)}: ${formatPercent(point.rate)} attack rate`}</title>
          </circle>
        ))}
        {trend.map((point, index) =>
          index % labelEvery === 0 ? (
            <text key={point.week} className="axis-label" x={x(index)} y={height - 6} textAnchor="middle">
              {formatDay(point.week)}
            </text>
          ) : null,
        )}
      </svg>
      <figcaption className="muted small">Weeks start Monday. Faded bars are partial weeks at the edge of the range.</figcaption>
    </figure>
  );
}

/** Attack type x destination port matrix. */
export function Heatmap({ heatmap, labelForType, labelForPort, onSelect }) {
  const { ports, types, cell, max } = heatmap;
  if (types.length === 0) return <p className="empty">No attacks in range.</p>;
  return (
    <div className="heatmap-wrap">
      <table className="heatmap">
        <thead>
          <tr>
            <th scope="col">Attack \ Port</th>
            {ports.map((port) => (
              <th key={port} scope="col" title={labelForPort(port)}>
                {port}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {types.map((type) => (
            <tr key={type}>
              <th scope="row">{labelForType(type)}</th>
              {ports.map((port) => {
                const value = cell(type, port);
                const intensity = value / max;
                return (
                  <td key={port}>
                    <button
                      type="button"
                      className="heat-cell"
                      style={{ '--heat': intensity }}
                      disabled={value === 0}
                      onClick={() => onSelect(type, port)}
                      title={`${labelForType(type)} on ${labelForPort(port)}: ${value} events`}
                    >
                      {value || ''}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 24-hour attack distribution strip. */
export function HourStrip({ hours }) {
  const max = Math.max(1, ...hours.map((hour) => hour.attacks));
  return (
    <div className="hour-strip" role="img" aria-label="Attacks by hour of day (UTC)">
      {hours.map((hour) => (
        <div key={hour.hour} className="hour-col" title={`${String(hour.hour).padStart(2, '0')}:00 UTC — ${hour.attacks} attacks / ${hour.total} events`}>
          <span className="hour-bar" style={{ height: `${(hour.attacks / max) * 100}%` }} />
          <span className="hour-label">{hour.hour % 6 === 0 ? String(hour.hour).padStart(2, '0') : ''}</span>
        </div>
      ))}
    </div>
  );
}

/** Semi-circular score gauge. */
export function ScoreGauge({ score, band }) {
  const radius = 70;
  const circumference = Math.PI * radius;
  const offset = circumference * (1 - score / 100);
  return (
    <div className={`gauge tone-${band.tone}`}>
      <svg viewBox="0 0 180 104" aria-hidden="true">
        <path className="gauge-track" d="M20,94 A70,70 0 0 1 160,94" />
        <path
          className="gauge-value"
          d="M20,94 A70,70 0 0 1 160,94"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="gauge-readout">
        <strong>{score}</strong>
        <span className="band-chip">{band.label}</span>
      </div>
    </div>
  );
}
