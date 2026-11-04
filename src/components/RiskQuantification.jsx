import { formatNumber, formatPercent, formatUsd, formatUsdCompact } from '../lib/analytics';

export default function RiskQuantification({ metrics, assumptions, onLossChange, onControlChange, onReset }) {
  const { attackTypes, inherentAle, residualAle, span } = metrics;
  const control = assumptions.controlEffectiveness;
  const maxAle = Math.max(1, ...attackTypes.map((item) => item.inherentAle));

  return (
    <article className="panel section-card quant-panel" aria-labelledby="quant-title">
      <div className="panel-head">
        <div>
          <h2 id="quant-title">Loss Exposure Model</h2>
          <span className="muted small">
            Annualized from {formatNumber(span.days)} days of observed attacks × expected loss per attempt
          </span>
        </div>
        <button type="button" className="ghost-button" onClick={onReset}>
          Reset assumptions
        </button>
      </div>

      <div className="quant-summary">
        <div className="quant-figure">
          <span className="stat-label">Inherent annual loss exposure</span>
          <strong>{formatUsdCompact(inherentAle)}</strong>
        </div>
        <div className="quant-figure accent">
          <span className="stat-label">Residual after controls</span>
          <strong>{formatUsdCompact(residualAle)}</strong>
        </div>
        <label className="control-slider">
          <span className="slider-head">
            <span className="stat-label">Control effectiveness</span>
            <output>{Math.round(control * 100)}%</output>
          </span>
          <input
            type="range"
            min="0"
            max="95"
            step="1"
            value={Math.round(control * 100)}
            onChange={(event) => onControlChange(Number(event.target.value) / 100)}
          />
          <span className="muted small">Saves {formatUsdCompact(inherentAle - residualAle)} per year at this level</span>
        </label>
      </div>

      <div className="table-wrap">
        <table className="quant-table">
          <thead>
            <tr>
              <th scope="col">Attack type</th>
              <th scope="col" className="num">Observed</th>
              <th scope="col" className="num">Per year</th>
              <th scope="col" className="num">Loss / attempt</th>
              <th scope="col">Annual exposure</th>
              <th scope="col" className="num">Residual</th>
            </tr>
          </thead>
          <tbody>
            {attackTypes.length === 0 && (
              <tr>
                <td colSpan={6} className="empty">
                  No attacks match the current filters.
                </td>
              </tr>
            )}
            {attackTypes.map((item) => (
              <tr key={item.type}>
                <th scope="row">
                  <span className={`sev sev-${item.severity}`} title={`Severity ${item.severity} of 5`}>
                    S{item.severity}
                  </span>
                  {item.label}
                </th>
                <td className="num">{formatNumber(item.count)}</td>
                <td className="num">{formatNumber(item.annualFrequency)}</td>
                <td className="num">
                  <label className="money-input">
                    <span aria-hidden="true">$</span>
                    <input
                      type="number"
                      min="0"
                      step="100"
                      value={item.lossPerEvent}
                      aria-label={`Expected loss per ${item.label} attempt`}
                      onChange={(event) => onLossChange(item.type, Math.max(0, Number(event.target.value) || 0))}
                    />
                  </label>
                </td>
                <td>
                  <div className="ale-cell">
                    <span>{formatUsd(item.inherentAle)}</span>
                    <span className="ale-bar" style={{ width: `${(item.inherentAle / maxAle) * 100}%` }} />
                  </div>
                </td>
                <td className="num">{formatUsd(item.residualAle)}</td>
              </tr>
            ))}
          </tbody>
          {attackTypes.length > 0 && (
            <tfoot>
              <tr>
                <th scope="row">Total</th>
                <td className="num">{formatNumber(metrics.attacks)}</td>
                <td className="num">{formatNumber(metrics.attacks * metrics.annualFactor)}</td>
                <td />
                <td>{formatUsd(inherentAle)}</td>
                <td className="num">{formatUsd(residualAle)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="footnote">
        Loss-per-attempt values are illustrative starting points (blending the chance an attempt succeeds with the
        cost if it does). Replace them with figures from your own incident history or insurance data. Changes are
        saved in this browser. Top driver: <strong>{metrics.byAle[0]?.label || '—'}</strong>
        {metrics.byAle[0] ? ` (${formatPercent(metrics.byAle[0].inherentAle / (inherentAle || 1), 0)} of exposure)` : ''}.
      </p>
    </article>
  );
}
