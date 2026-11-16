import { useState } from 'react';
import { formatNumber, formatPercent, formatUsd, formatUsdCompact, formatUsdShort } from '../lib/analytics';
import { DEFAULT_SCENARIO_RANGE } from '../lib/risk';
import { LossExceedanceChart } from './Charts';
import { AppetiteBadge, AppetiteEditor, StatsComparison, chance } from './RiskShared';

const percent = (range) => {
  const fmt = (v) => `${Math.round(v * 100)}%`;
  return `−${fmt(range.min)} / ${fmt(range.likely)} / ${fmt(range.max)}`;
};

function ScenarioList({ analysis, onAppetiteChange }) {
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const { appetite, portfolio, scenarios, flaggedCount, flaggedBeforeCount } = analysis;
  const visible = [...scenarios]
    .filter((scenario) => !flaggedOnly || scenario.flagged)
    .sort((a, b) => b.residual.stats.mean - a.residual.stats.mean);

  return (
    <>
      <article className="panel section-card" aria-labelledby="appetite-title">
        <div className="panel-head">
          <div>
            <h2 id="appetite-title">Risk Appetite</h2>
            <span className="muted small">Organization-wide limit, applied to every scenario and drawn on every curve</span>
          </div>
          <span className={`badge ${flaggedCount ? 'badge-over' : 'badge-ok'}`}>
            {flaggedCount} of {scenarios.length} scenarios over appetite
          </span>
        </div>
        <AppetiteEditor appetite={appetite} onChange={onAppetiteChange} />
        <p className="footnote">
          Before controls, {flaggedBeforeCount} of {scenarios.length} scenarios cross this limit; after the attached
          controls, {flaggedCount} {flaggedCount === 1 ? 'does' : 'do'}.
        </p>
      </article>

      <section className="grid two-col">
        <article className="panel section-card" aria-labelledby="portfolio-title">
          <div className="panel-head">
            <div>
              <h2 id="portfolio-title">Portfolio: Before vs. After Controls</h2>
              <span className="muted small">
                All {scenarios.length} scenarios added together, year by year · {formatNumber(analysis.settings.trials)}{' '}
                simulated years
              </span>
            </div>
          </div>
          <LossExceedanceChart
            before={portfolio.inherent.curve}
            after={portfolio.residual.curve}
            maxLoss={portfolio.maxLoss}
            appetite={appetite}
          />
        </article>
        <article className="panel section-card" aria-labelledby="portfolio-stats-title">
          <div className="panel-head">
            <div>
              <h2 id="portfolio-stats-title">Portfolio Statistics</h2>
              <span className="muted small">Inherent (before) vs. residual (after) annual loss</span>
            </div>
          </div>
          <StatsComparison inherent={portfolio.inherent} residual={portfolio.residual} appetite={appetite} />
          <p className="footnote">
            Controls remove an expected <strong>{formatUsdCompact(portfolio.riskReduction)}</strong> per year. The
            appetite limit is set per scenario, so the combined portfolio will usually sit above it.
          </p>
        </article>
      </section>

      <article className="panel section-card" aria-labelledby="scenarios-title">
        <div className="panel-head">
          <div>
            <h2 id="scenarios-title">Risk Scenarios</h2>
            <span className="muted small">One per attack type in the dataset · select a row for its curves and inputs</span>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={flaggedOnly} onChange={(event) => setFlaggedOnly(event.target.checked)} />
            Only show scenarios over appetite ({flaggedCount})
          </label>
        </div>
        <div className="table-wrap">
          <table className="scenario-table">
            <thead>
              <tr>
                <th scope="col">Scenario</th>
                <th scope="col">Appetite</th>
                <th scope="col" className="num">Mean loss before</th>
                <th scope="col" className="num">Mean loss after</th>
                <th scope="col" className="num">95th pct. after</th>
                <th scope="col" className="num">Chance over {formatUsdShort(appetite.lossThreshold)}</th>
                <th scope="col" className="num">Controls</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty">
                    {scenarios.length === 0 ? 'No attacks in the dataset.' : 'No scenario is over appetite.'}
                  </td>
                </tr>
              )}
              {visible.map((scenario) => (
                <tr key={scenario.id} className={scenario.flagged ? 'row-flagged' : undefined}>
                  <th scope="row">
                    <a className="row-link" href={`#/scenarios/${encodeURIComponent(scenario.id)}`}>
                      <span className={`sev sev-${scenario.severity}`}>S{scenario.severity}</span>
                      {scenario.name}
                    </a>
                  </th>
                  <td>
                    <AppetiteBadge over={scenario.flagged} />
                  </td>
                  <td className="num">{formatUsd(scenario.inherent.stats.mean)}</td>
                  <td className="num strong">{formatUsd(scenario.residual.stats.mean)}</td>
                  <td className="num">{formatUsd(scenario.residual.stats.p95)}</td>
                  <td className="num">
                    {chance(scenario.inherent.stats.exceedProbability)} → {chance(scenario.residual.stats.exceedProbability)}
                  </td>
                  <td className="num">{scenario.controls.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    </>
  );
}

function RangeInput({ label, value, onChange }) {
  return (
    <label className="money-input">
      <input
        type="number"
        min="0"
        max="1000"
        step="5"
        value={Math.round(value * 100)}
        aria-label={label}
        onChange={(event) => onChange(Math.max(0, Number(event.target.value) || 0) / 100)}
      />
      <span aria-hidden="true">%</span>
    </label>
  );
}

function ScenarioDetail({ scenario, analysis, onRangeChange, onLossChange, onToggleControl }) {
  const { appetite } = analysis;
  const { range, frequency, magnitude } = scenario;
  const setRange = (key, value) => onRangeChange(scenario.id, { ...range, [key]: value });

  return (
    <>
      <article className="panel section-card detail-head">
        <a className="ghost-button" href="#/scenarios">
          ← All scenarios
        </a>
        <div>
          <h2>
            <span className={`sev sev-${scenario.severity}`}>S{scenario.severity}</span>
            {scenario.name}
          </h2>
          <span className="muted small">
            {formatNumber(scenario.observed)} attempts observed · about {formatNumber(frequency.likely)} per year ·{' '}
            {scenario.controls.length} control{scenario.controls.length === 1 ? '' : 's'} attached
          </span>
        </div>
        <AppetiteBadge over={scenario.flagged} />
      </article>

      <section className="grid two-col">
        <article className="panel section-card" aria-labelledby="scenario-lec-title">
          <div className="panel-head">
            <div>
              <h2 id="scenario-lec-title">Before vs. After Controls</h2>
              <span className="muted small">
                Inherent and residual loss exceedance curves · same {formatNumber(analysis.settings.trials)} simulated
                years for both
              </span>
            </div>
          </div>
          <LossExceedanceChart
            before={scenario.inherent.curve}
            after={scenario.residual.curve}
            maxLoss={scenario.maxLoss}
            appetite={appetite}
          />
        </article>
        <article className="panel section-card" aria-labelledby="scenario-stats-title">
          <div className="panel-head">
            <div>
              <h2 id="scenario-stats-title">Inherent vs. Residual Risk</h2>
              <span className="muted small">Annual loss, before and after the attached controls</span>
            </div>
          </div>
          <StatsComparison inherent={scenario.inherent} residual={scenario.residual} appetite={appetite} />
          <p className="footnote">
            Risk reduction (inherent − residual mean loss): <strong>{formatUsd(scenario.riskReduction)}</strong> per year.
          </p>
        </article>
      </section>

      <section className="grid two-col">
        <article className="panel section-card" aria-labelledby="scenario-controls-title">
          <div className="panel-head">
            <div>
              <h2 id="scenario-controls-title">Attached Controls</h2>
              <span className="muted small">Tick a control to apply it to this scenario; the curves update immediately</span>
            </div>
            <a className="ghost-button" href="#/controls">
              Manage controls
            </a>
          </div>
          {analysis.controls.length === 0 ? (
            <p className="empty">No controls defined yet.</p>
          ) : (
            <ul className="control-picker">
              {analysis.controls.map((control) => {
                const attached = control.scenarioIds.includes(scenario.id);
                return (
                  <li key={control.id}>
                    <label className={attached ? 'selected' : undefined}>
                      <input type="checkbox" checked={attached} onChange={() => onToggleControl(control.id, scenario.id)} />
                      <span>
                        <strong>{control.name}</strong>
                        <span className="muted small">
                          {[
                            control.lefReduction.max > 0 && `Frequency ${percent(control.lefReduction)}`,
                            control.lmReduction.max > 0 && `Loss size ${percent(control.lmReduction)}`,
                          ]
                            .filter(Boolean)
                            .join(' · ') || 'No effect entered'}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </article>

        <article className="panel section-card" aria-labelledby="fair-title">
          <div className="panel-head">
            <div>
              <h2 id="fair-title">FAIR Inputs</h2>
              <span className="muted small">Minimum / most likely / maximum ranges fed to the simulation</span>
            </div>
            <button
              type="button"
              className="ghost-button"
              onClick={() => onRangeChange(scenario.id, DEFAULT_SCENARIO_RANGE)}
            >
              Reset ranges
            </button>
          </div>
          <div className="table-wrap">
            <table className="fair-table">
              <thead>
                <tr>
                  <th scope="col">Input</th>
                  <th scope="col" className="num">Minimum</th>
                  <th scope="col" className="num">Most likely</th>
                  <th scope="col" className="num">Maximum</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Loss event frequency (per year)</th>
                  <td className="num">{formatNumber(frequency.min)}</td>
                  <td className="num strong">{formatNumber(frequency.likely)}</td>
                  <td className="num">{formatNumber(frequency.max)}</td>
                </tr>
                <tr className="input-row">
                  <th scope="row" className="muted small">as % of most likely</th>
                  <td className="num">
                    <RangeInput label="Minimum frequency, percent of most likely" value={range.freqLow} onChange={(v) => setRange('freqLow', v)} />
                  </td>
                  <td className="num muted small">from the data</td>
                  <td className="num">
                    <RangeInput label="Maximum frequency, percent of most likely" value={range.freqHigh} onChange={(v) => setRange('freqHigh', v)} />
                  </td>
                </tr>
                <tr>
                  <th scope="row">Loss magnitude (per event)</th>
                  <td className="num">{formatUsd(magnitude.min)}</td>
                  <td className="num strong">{formatUsd(magnitude.likely)}</td>
                  <td className="num">{formatUsd(magnitude.max)}</td>
                </tr>
                <tr className="input-row">
                  <th scope="row" className="muted small">as % of most likely</th>
                  <td className="num">
                    <RangeInput label="Minimum loss, percent of most likely" value={range.lossLow} onChange={(v) => setRange('lossLow', v)} />
                  </td>
                  <td className="num">
                    <label className="money-input">
                      <span aria-hidden="true">$</span>
                      <input
                        type="number"
                        min="0"
                        step="100"
                        value={magnitude.likely}
                        aria-label="Most likely loss per event, in dollars"
                        onChange={(event) => onLossChange(scenario.id, Math.max(0, Number(event.target.value) || 0))}
                      />
                    </label>
                  </td>
                  <td className="num">
                    <RangeInput label="Maximum loss, percent of most likely" value={range.lossHigh} onChange={(v) => setRange('lossHigh', v)} />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="footnote">
            Most likely frequency is the observed attempt count scaled to a year. Most likely loss is the same
            “loss per attempt” used on the Dashboard, so editing it here changes it there too. Simulated mean loss is
            usually above frequency × loss because the ranges stretch further up than down
            ({formatPercent(range.lossHigh, 0)} vs {formatPercent(range.lossLow, 0)}).
          </p>
        </article>
      </section>
    </>
  );
}

export default function ScenariosView({ analysis, selectedId, onAppetiteChange, onRangeChange, onLossChange, onToggleControl }) {
  const selected = selectedId ? analysis.scenarios.find((scenario) => scenario.id === selectedId) : null;
  if (selectedId && !selected) {
    return (
      <article className="panel section-card">
        <p className="empty">
          That scenario is not in the current dataset. <a href="#/scenarios">Back to all scenarios</a>
        </p>
      </article>
    );
  }
  return selected ? (
    <ScenarioDetail
      scenario={selected}
      analysis={analysis}
      onRangeChange={onRangeChange}
      onLossChange={onLossChange}
      onToggleControl={onToggleControl}
    />
  ) : (
    <ScenarioList analysis={analysis} onAppetiteChange={onAppetiteChange} />
  );
}
