import { formatPercent, formatUsd, formatUsdShort } from '../lib/analytics';

export const chance = (probability) => (probability > 0 && probability < 0.01 ? '<1%' : formatPercent(probability, 0));

/** "Over appetite" / "Within appetite" badge. Icon + text, never colour alone. */
export function AppetiteBadge({ over, compact = false }) {
  return over ? (
    <span className="badge badge-over" title="The chance of exceeding the loss limit is higher than the risk appetite allows">
      <span aria-hidden="true">▲</span> {compact ? 'Over' : 'Over appetite'}
    </span>
  ) : (
    <span className="badge badge-ok" title="Within risk appetite">
      <span aria-hidden="true">✓</span> {compact ? 'Within' : 'Within appetite'}
    </span>
  );
}

/** Organization-level risk appetite: "no more than P% chance of losing more than $X per year". */
export function AppetiteEditor({ appetite, onChange }) {
  return (
    <div className="appetite-editor">
      <span>No more than a</span>
      <label className="money-input">
        <input
          type="number"
          min="1"
          max="99"
          step="1"
          value={Math.round(appetite.probability * 100)}
          aria-label="Maximum acceptable chance, in percent"
          onChange={(event) =>
            onChange({ ...appetite, probability: Math.min(99, Math.max(1, Number(event.target.value) || 1)) / 100 })
          }
        />
        <span aria-hidden="true">%</span>
      </label>
      <span>chance of losing more than</span>
      <label className="money-input wide">
        <span aria-hidden="true">$</span>
        <input
          type="number"
          min="0"
          step="50000"
          value={appetite.lossThreshold}
          aria-label="Loss limit per year, in dollars"
          onChange={(event) => onChange({ ...appetite, lossThreshold: Math.max(0, Number(event.target.value) || 0) })}
        />
      </label>
      <span>per year.</span>
    </div>
  );
}

function change(before, after) {
  if (!(before > 0)) return '—';
  const delta = after / before - 1;
  if (Math.abs(delta) < 0.0005) return 'no change';
  return `${delta > 0 ? '+' : '−'}${Math.abs(delta * 100).toFixed(0)}%`;
}

/** Side-by-side statistics for a before/after pair produced by lib/risk.js. */
export function StatsComparison({ inherent, residual, appetite }) {
  const rows = [
    { label: 'Mean annual loss (ALE)', key: 'mean' },
    { label: 'Median year', key: 'median' },
    { label: '90th percentile year', key: 'p90' },
    { label: '95th percentile year', key: 'p95' },
  ];
  return (
    <div className="table-wrap">
      <table className="compare-table">
        <thead>
          <tr>
            <th scope="col">Measure</th>
            <th scope="col" className="num">Before controls</th>
            <th scope="col" className="num">After controls</th>
            <th scope="col" className="num">Change</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row">{row.label}</th>
              <td className="num">{formatUsd(inherent.stats[row.key])}</td>
              <td className="num strong">{formatUsd(residual.stats[row.key])}</td>
              <td className="num muted">{change(inherent.stats[row.key], residual.stats[row.key])}</td>
            </tr>
          ))}
          <tr>
            <th scope="row">Chance of losing more than {formatUsdShort(appetite.lossThreshold)}</th>
            <td className="num">
              {chance(inherent.stats.exceedProbability)} <AppetiteBadge over={inherent.overAppetite} compact />
            </td>
            <td className="num strong">
              {chance(residual.stats.exceedProbability)} <AppetiteBadge over={residual.overAppetite} compact />
            </td>
            <td className="num muted">limit {formatPercent(appetite.probability, 0)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
