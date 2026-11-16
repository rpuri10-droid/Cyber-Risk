import { useState } from 'react';
import { formatUsd } from '../lib/analytics';

const EMPTY_RANGE = { min: 0, likely: 0, max: 0 };
const EMPTY_DRAFT = {
  id: null,
  name: '',
  description: '',
  annualCost: 0,
  implementationCost: 0,
  lefReduction: EMPTY_RANGE,
  lmReduction: EMPTY_RANGE,
  scenarioIds: [],
};

function roiText(roi) {
  if (!Number.isFinite(roi)) return '∞';
  return `${roi >= 0 ? '+' : '−'}${Math.abs(roi * 100).toFixed(0)}%`;
}

function paybackShort(years) {
  if (years == null) return 'Never';
  const months = years * 12;
  if (months < 1) return '< 1 month';
  if (months < 11.5) return `${Math.round(months)} mo`;
  return `${years.toFixed(1)} yr`;
}

function Verdict({ worthIt }) {
  return worthIt ? (
    <span className="badge badge-ok">
      <span aria-hidden="true">✓</span> Worth it
    </span>
  ) : (
    <span className="badge badge-over">
      <span aria-hidden="true">✕</span> Not worth it
    </span>
  );
}

function RangeFields({ legend, range, onChange }) {
  return (
    <fieldset className="range-fields">
      <legend>{legend}</legend>
      {[
        ['min', 'Min'],
        ['likely', 'Likely'],
        ['max', 'Max'],
      ].map(([key, label]) => (
        <label key={key}>
          <span>{label}</span>
          <span className="money-input">
            <input
              type="number"
              min="0"
              max="100"
              step="1"
              value={Math.round(range[key] * 100)}
              onChange={(event) =>
                onChange({ ...range, [key]: Math.min(100, Math.max(0, Number(event.target.value) || 0)) / 100 })
              }
            />
            <span aria-hidden="true">%</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function ControlForm({ draft, scenarios, onChange, onSubmit, onCancel }) {
  const set = (key, value) => onChange({ ...draft, [key]: value });
  const toggleScenario = (id) =>
    set('scenarioIds', draft.scenarioIds.includes(id) ? draft.scenarioIds.filter((s) => s !== id) : [...draft.scenarioIds, id]);
  const money = (key, label) => (
    <label>
      <span>{label}</span>
      <span className="money-input wide">
        <span aria-hidden="true">$</span>
        <input type="number" min="0" step="1000" value={draft[key]} onChange={(event) => set(key, Math.max(0, Number(event.target.value) || 0))} />
      </span>
    </label>
  );

  return (
    <form
      className="control-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (draft.name.trim()) onSubmit(draft);
      }}
    >
      <label className="span-2">
        <span>Name</span>
        <input type="text" required value={draft.name} placeholder="e.g. Email filtering gateway" onChange={(event) => set('name', event.target.value)} />
      </label>
      <label className="span-2">
        <span>Description</span>
        <input type="text" value={draft.description} onChange={(event) => set('description', event.target.value)} />
      </label>
      {money('annualCost', 'Annual cost')}
      {money('implementationCost', 'Implementation cost (one-off)')}
      <RangeFields legend="Reduces loss event frequency by" range={draft.lefReduction} onChange={(value) => set('lefReduction', value)} />
      <RangeFields legend="Reduces loss magnitude by" range={draft.lmReduction} onChange={(value) => set('lmReduction', value)} />
      <fieldset className="span-2 scenario-checks">
        <legend>Applies to scenarios</legend>
        {scenarios.map((scenario) => (
          <label key={scenario.id}>
            <input type="checkbox" checked={draft.scenarioIds.includes(scenario.id)} onChange={() => toggleScenario(scenario.id)} />
            {scenario.name}
          </label>
        ))}
      </fieldset>
      <div className="span-2 form-actions">
        <button type="submit" className="primary-button">
          {draft.id ? 'Save changes' : 'Add control'}
        </button>
        {draft.id && (
          <button type="button" className="ghost-button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

export default function ControlsView({ analysis, onSave, onDelete, onResetControls, onAmortizationChange }) {
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const { controls, scenarios, settings } = analysis;
  const worthCount = controls.filter((control) => control.worthIt).length;

  const edit = (control) => {
    setDraft({
      id: control.id,
      name: control.name,
      description: control.description,
      annualCost: control.annualCost,
      implementationCost: control.implementationCost,
      lefReduction: control.lefReduction,
      lmReduction: control.lmReduction,
      scenarioIds: control.scenarioIds,
    });
    document.getElementById('control-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <>
      <article className="panel section-card" aria-labelledby="roi-title">
        <div className="panel-head">
          <div>
            <h2 id="roi-title">Control ROI Ranking</h2>
            <span className="muted small">
              Best return first · {worthCount} of {controls.length} controls pay for themselves
            </span>
          </div>
          <label className="inline-setting">
            <span className="muted small">Spread implementation cost over</span>
            <span className="money-input">
              <input
                type="number"
                min="1"
                max="10"
                step="1"
                value={settings.amortizationYears}
                aria-label="Years to spread implementation cost over"
                onChange={(event) => onAmortizationChange(Math.min(10, Math.max(1, Math.round(Number(event.target.value) || 1))))}
              />
              <span aria-hidden="true">yr</span>
            </span>
          </label>
        </div>
        <div className="table-wrap">
          <table className="roi-table">
            <thead>
              <tr>
                <th scope="col" className="num">#</th>
                <th scope="col">Control</th>
                <th scope="col">Verdict</th>
                <th scope="col" className="num">Cost / year</th>
                <th scope="col" className="num">Risk reduction / year</th>
                <th scope="col" className="num">ROI</th>
                <th scope="col" className="num">Payback</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {controls.length === 0 && (
                <tr>
                  <td colSpan={8} className="empty">
                    No controls yet. Add one below.
                  </td>
                </tr>
              )}
              {controls.map((control, index) => (
                <tr key={control.id}>
                  <td className="num muted">{index + 1}</td>
                  <th scope="row">
                    <span className="control-name">{control.name}</span>
                    <span className="muted small control-meta">
                      {control.scenarios.length
                        ? `Covers ${control.scenarios.map((s) => s.name).join(', ')}`
                        : 'Not attached to any scenario'}
                    </span>
                  </th>
                  <td>
                    <Verdict worthIt={control.worthIt} />
                  </td>
                  <td className="num" title={`${formatUsd(control.annualCost)} per year + ${formatUsd(control.implementationCost)} one-off`}>
                    {formatUsd(control.annualizedCost)}
                  </td>
                  <td className="num">{formatUsd(control.riskReduction)}</td>
                  <td className="num strong">{roiText(control.roi)}</td>
                  <td className="num">{paybackShort(control.paybackYears)}</td>
                  <td className="row-actions">
                    <button type="button" className="ghost-button" onClick={() => edit(control)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => {
                        if (window.confirm(`Delete “${control.name}”?`)) {
                          onDelete(control.id);
                          if (draft.id === control.id) setDraft(EMPTY_DRAFT);
                        }
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="footnote">
          Risk reduction = inherent ALE − residual ALE with only that control applied, across the scenarios it covers.
          Cost / year = annual cost + implementation cost ÷ {settings.amortizationYears} years. ROI = (risk reduction −
          cost) ÷ cost. Payback = implementation cost ÷ (risk reduction − annual cost). A control is{' '}
          <strong>worth it</strong> when ROI is above 0%. Each control is re-simulated with the same random seed as the
          baseline, so the difference is the control and not luck.
        </p>
      </article>

      <article className="panel section-card" id="control-form" aria-labelledby="form-title">
        <div className="panel-head">
          <div>
            <h2 id="form-title">{draft.id ? `Edit: ${draft.name || 'control'}` : 'Add a Control'}</h2>
            <span className="muted small">Effects are entered as minimum / most likely / maximum % reductions</span>
          </div>
          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              if (window.confirm('Replace all controls with the demo set? Your edits to controls will be lost.')) {
                onResetControls();
                setDraft(EMPTY_DRAFT);
              }
            }}
          >
            Restore demo controls
          </button>
        </div>
        <ControlForm
          draft={draft}
          scenarios={scenarios}
          onChange={setDraft}
          onCancel={() => setDraft(EMPTY_DRAFT)}
          onSubmit={(control) => {
            onSave(control);
            setDraft(EMPTY_DRAFT);
          }}
        />
      </article>
    </>
  );
}
