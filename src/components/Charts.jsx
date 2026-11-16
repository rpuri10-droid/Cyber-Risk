import { useState } from 'react';
import { DAY_MS, formatDay, formatNumber, formatPercent, formatUsdShort } from '../lib/analytics';

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

const chancePercent = (probability) => {
  if (probability > 0 && probability < 0.01) return '<1%';
  return formatPercent(probability, 0);
};

/**
 * Loss exceedance curve: for each loss amount on the x-axis, the chance (y-axis) that a
 * year's total loss is larger. Draws one curve, or a before/after pair on the same axes,
 * plus the risk appetite limit. Curves come pre-computed from lib/risk.js.
 *
 * before / after: [{ loss, probability }] sharing the same loss values; `after` is optional.
 * appetite: { probability, lossThreshold }.
 */
export function LossExceedanceChart({ before, after, maxLoss, appetite, beforeLabel = 'Before controls', afterLabel = 'After controls' }) {
  const [hover, setHover] = useState(null);
  const width = 640;
  const height = 310;
  const margin = { left: 46, right: 18, top: 26, bottom: 40 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const top = Math.max(1, maxLoss);
  const x = (loss) => margin.left + Math.min(1, loss / top) * plotWidth;
  const y = (probability) => margin.top + (1 - probability) * plotHeight;
  const pathFor = (curve) =>
    curve.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(point.loss).toFixed(1)},${y(point.probability).toFixed(1)}`).join(' ');

  const limitOnScale = appetite.lossThreshold <= top;
  const limitX = x(appetite.lossThreshold);
  const limitY = y(appetite.probability);
  const limitText = `Limit: ${formatPercent(appetite.probability, 0)} chance of more than ${formatUsdShort(appetite.lossThreshold)}`;

  const onMove = (event) => {
    const box = event.currentTarget.getBoundingClientRect();
    const svgX = ((event.clientX - box.left) / box.width) * width;
    const ratio = Math.min(1, Math.max(0, (svgX - margin.left) / plotWidth));
    setHover(Math.round(ratio * (before.length - 1)));
  };
  const point = hover == null ? null : before[hover];
  const afterPoint = hover == null || !after ? null : after[hover];

  return (
    <figure className="lec-figure">
      <ul className="chart-legend" aria-hidden="true">
        <li>
          <span className={`legend-line${after ? ' before' : ' after'}`} />
          {after ? beforeLabel : 'Annual loss'}
        </li>
        {after && (
          <li>
            <span className="legend-line after" />
            {afterLabel}
          </li>
        )}
        <li>
          <span className="legend-line limit" />
          Risk appetite limit
        </li>
      </ul>
      <div className="lec-plot">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`Loss exceedance curve${after ? ', before and after controls' : ''}. ${limitText}.`}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          <text className="axis-title" x={margin.left} y={12}>
            Chance of losing more than…
          </text>
          {[0, 0.25, 0.5, 0.75, 1].map((tick) => (
            <g key={tick}>
              <line className="gridline" x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} />
              <text className="axis-label" x={margin.left - 6} y={y(tick) + 3} textAnchor="end">
                {formatPercent(tick, 0)}
              </text>
            </g>
          ))}
          {[0, 0.25, 0.5, 0.75, 1].map((tick) => (
            <text
              key={tick}
              className="axis-label"
              x={margin.left + tick * plotWidth}
              y={height - margin.bottom + 16}
              textAnchor={tick === 0 ? 'start' : tick === 1 ? 'end' : 'middle'}
            >
              {formatUsdShort(top * tick)}
            </text>
          ))}
          <text className="axis-title" x={margin.left + plotWidth / 2} y={height - 4} textAnchor="middle">
            Loss in one year
          </text>

          <line className="limit-line" x1={margin.left} x2={width - margin.right} y1={limitY} y2={limitY} />
          {limitOnScale && <line className="limit-line" x1={limitX} x2={limitX} y1={margin.top} y2={margin.top + plotHeight} />}
          <text
            className="limit-label"
            x={width - margin.right - 4}
            y={limitY - 6 < margin.top + 10 ? limitY + 14 : limitY - 6}
            textAnchor="end"
          >
            {limitOnScale ? limitText : `${limitText} (beyond this chart →)`}
          </text>

          <path className={`lec-line${after ? ' before' : ' after'}`} d={pathFor(before)} />
          {after && <path className="lec-line after" d={pathFor(after)} />}
          {limitOnScale && <circle className="limit-dot" cx={limitX} cy={limitY} r={5} />}

          {point && (
            <g pointerEvents="none">
              <line className="crosshair" x1={x(point.loss)} x2={x(point.loss)} y1={margin.top} y2={margin.top + plotHeight} />
              <circle className={`lec-dot${after ? ' before' : ' after'}`} cx={x(point.loss)} cy={y(point.probability)} r={4} />
              {afterPoint && <circle className="lec-dot after" cx={x(afterPoint.loss)} cy={y(afterPoint.probability)} r={4} />}
            </g>
          )}
        </svg>
        {point && (
          <div
            className={`chart-tooltip${x(point.loss) > width * 0.6 ? ' flip' : ''}`}
            style={{ left: `${(x(point.loss) / width) * 100}%` }}
            role="status"
          >
            <strong>More than {formatUsdShort(point.loss)}</strong>
            <span>
              <span className={`legend-line${after ? ' before' : ' after'}`} />
              {after ? beforeLabel : 'Chance'}: {chancePercent(point.probability)}
            </span>
            {afterPoint && (
              <span>
                <span className="legend-line after" />
                {afterLabel}: {chancePercent(afterPoint.probability)}
              </span>
            )}
          </div>
        )}
      </div>
      <figcaption className="muted small">
        Read it as: pick a loss on the bottom axis, and the curve shows the chance of a year costing more than that.
        {after ? ' The gap between the two curves is what the controls remove.' : ''} A curve passing above the
        marked limit is outside risk appetite.
      </figcaption>
    </figure>
  );
}
