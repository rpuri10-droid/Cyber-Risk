import { describe, expect, it } from 'vitest';
import {
  analyzeRisk,
  buildScenarios,
  chanceText,
  combineReductions,
  controlRoi,
  exceedsAppetite,
  executiveSummary,
  headlineLoss,
  paybackText,
  riskReduction,
  riskSentence,
} from '../risk';
import { exceedanceProbability } from '../simulation';

const fixed = (value) => ({ min: value, likely: value, max: value });
const settings = { seed: 7, trials: 5_000, amortizationYears: 3 };

const attackTypes = [
  { type: 'sql-injection', label: 'SQL injection', severity: 4, count: 64, annualFrequency: 260, lossPerEvent: 8_000 },
  { type: 'port-scan', label: 'Port scan', severity: 1, count: 81, annualFrequency: 330, lossPerEvent: 100 },
];
const scenarios = buildScenarios(attackTypes);
const control = (overrides) => ({
  id: 'c',
  name: 'Control',
  annualCost: 100_000,
  implementationCost: 0,
  lefReduction: fixed(0),
  lmReduction: fixed(0),
  scenarioIds: ['sql-injection'],
  ...overrides,
});

describe('ROI', () => {
  it('risk reduction = inherent ALE − residual ALE, floored at zero', () => {
    expect(riskReduction(1_000_000, 400_000)).toBe(600_000);
    expect(riskReduction(100, 250)).toBe(0);
  });

  it('ROI = (risk reduction − control cost) / control cost, with implementation cost amortized', () => {
    const result = controlRoi({ riskReduction: 500_000, annualCost: 70_000, implementationCost: 90_000, amortizationYears: 3 });
    expect(result.annualizedCost).toBe(100_000);
    expect(result.netBenefit).toBe(400_000);
    expect(result.roi).toBe(4);
    expect(result.returnPerDollar).toBe(5);
    expect(result.worthIt).toBe(true);
  });

  it('payback period = implementation cost / (risk reduction − annual cost)', () => {
    const result = controlRoi({ riskReduction: 250_000, annualCost: 50_000, implementationCost: 100_000 });
    expect(result.paybackYears).toBe(0.5);
  });

  it('a control that costs more than it saves is not worth it and never pays back', () => {
    const result = controlRoi({ riskReduction: 50_000, annualCost: 80_000, implementationCost: 60_000, amortizationYears: 3 });
    expect(result.roi).toBeCloseTo(-0.5, 10);
    expect(result.worthIt).toBe(false);
    expect(result.paybackYears).toBeNull();
  });

  it('break-even (ROI exactly 0) is not flagged as worth it', () => {
    expect(controlRoi({ riskReduction: 100, annualCost: 100, implementationCost: 0 }).worthIt).toBe(false);
  });

  it('handles free controls and zero reduction without dividing by zero', () => {
    expect(controlRoi({ riskReduction: 10, annualCost: 0, implementationCost: 0 }).roi).toBe(Infinity);
    expect(controlRoi({ riskReduction: 0, annualCost: 0, implementationCost: 0 }).roi).toBe(0);
    expect(controlRoi({ riskReduction: 10, annualCost: 0, implementationCost: 0 }).paybackYears).toBe(0);
  });

  it('combined reductions multiply: 1 − Π(1 − r)', () => {
    expect(combineReductions([0.5, 0.5])).toBe(0.75);
    expect(combineReductions([])).toBe(0);
    expect(combineReductions([0.2, 1])).toBe(1);
  });
});

describe('risk appetite threshold', () => {
  const appetite = { probability: 0.1, lossThreshold: 1_000_000 };

  it('flags only when the chance of exceeding the loss is above the allowed probability', () => {
    expect(exceedsAppetite(0.11, appetite)).toBe(true);
    expect(exceedsAppetite(0.1, appetite)).toBe(false);
    expect(exceedsAppetite(0.02, appetite)).toBe(false);
  });

  it('flags scenarios whose after-controls curve crosses the threshold', () => {
    const analysis = analyzeRisk({ scenarios, controls: [], appetite, settings });
    const [sql, scan] = analysis.scenarios;
    expect(sql.inherent.stats.exceedProbability).toBeGreaterThan(0.9);
    expect(sql.flagged).toBe(true);
    expect(scan.flagged).toBe(false);
    expect(analysis.flaggedCount).toBe(1);
  });

  it('raising the threshold or the allowed probability clears the flag', () => {
    const lenientLoss = analyzeRisk({ scenarios, appetite: { probability: 0.1, lossThreshold: 50_000_000 }, settings });
    const lenientOdds = analyzeRisk({ scenarios, appetite: { probability: 1, lossThreshold: 1_000_000 }, settings });
    expect(lenientLoss.flaggedCount).toBe(0);
    expect(lenientOdds.flaggedCount).toBe(0);
  });

  it('a strong enough control removes the flag, and the before-controls count is kept', () => {
    const strong = control({ lefReduction: fixed(0.9) });
    const analysis = analyzeRisk({ scenarios, controls: [strong], appetite, settings });
    expect(analysis.scenarios[0].flagged).toBe(false);
    expect(analysis.flaggedCount).toBe(0);
    expect(analysis.flaggedBeforeCount).toBe(1);
  });
});

describe('residual risk', () => {
  const appetite = { probability: 0.1, lossThreshold: 1_000_000 };

  it('without controls, residual equals inherent', () => {
    const { scenarios: results, portfolio } = analyzeRisk({ scenarios, appetite, settings });
    results.forEach((s) => expect(s.residual.stats).toEqual(s.inherent.stats));
    expect(portfolio.riskReduction).toBe(0);
  });

  it('residual ALE = inherent ALE × (1 − reduction) for a fixed magnitude reduction', () => {
    const analysis = analyzeRisk({ scenarios, controls: [control({ lmReduction: fixed(0.4) })], appetite, settings });
    const sql = analysis.scenarios[0];
    expect(sql.residual.stats.mean).toBeCloseTo(sql.inherent.stats.mean * 0.6, 4);
    expect(sql.riskReduction).toBeCloseTo(sql.inherent.stats.mean * 0.4, 4);
    expect(sql.residual.stats.p95).toBeCloseTo(sql.inherent.stats.p95 * 0.6, 4);
  });

  it('controls only affect the scenarios they are attached to', () => {
    const analysis = analyzeRisk({ scenarios, controls: [control({ lmReduction: fixed(0.4) })], appetite, settings });
    const scan = analysis.scenarios[1];
    expect(scan.controls).toHaveLength(0);
    expect(scan.residual.stats.mean).toBe(scan.inherent.stats.mean);
  });

  it('the portfolio is the year-by-year sum of its scenarios', () => {
    const analysis = analyzeRisk({ scenarios, controls: [control({ lmReduction: fixed(0.4) })], appetite, settings });
    const sumOf = (key) => analysis.scenarios.reduce((sum, s) => sum + s[key].stats.mean, 0);
    expect(analysis.portfolio.inherent.stats.mean).toBeCloseTo(sumOf('inherent'), 4);
    expect(analysis.portfolio.residual.stats.mean).toBeCloseTo(sumOf('residual'), 4);
    expect(analysis.portfolio.inherent.losses[0]).toBeCloseTo(
      analysis.scenarios[0].inherent.losses[0] + analysis.scenarios[1].inherent.losses[0],
      6,
    );
  });

  it('before and after curves share one loss axis', () => {
    const analysis = analyzeRisk({ scenarios, controls: [control({ lmReduction: fixed(0.4) })], appetite, settings });
    const sql = analysis.scenarios[0];
    expect(sql.inherent.curve.map((p) => p.loss)).toEqual(sql.residual.curve.map((p) => p.loss));
    sql.residual.curve.forEach((point, i) => expect(point.probability).toBeLessThanOrEqual(sql.inherent.curve[i].probability));
  });
});

describe('control ranking', () => {
  const appetite = { probability: 0.1, lossThreshold: 1_000_000 };
  const good = control({ id: 'good', name: 'Good', annualCost: 50_000, lmReduction: fixed(0.5) });
  const bad = control({ id: 'bad', name: 'Bad', annualCost: 500_000, lmReduction: fixed(0.5), scenarioIds: ['port-scan'] });
  const analysis = analyzeRisk({ scenarios, controls: [bad, good], appetite, settings });

  it('ranks controls by ROI, best first, with a worth-it verdict', () => {
    expect(analysis.controls.map((c) => c.id)).toEqual(['good', 'bad']);
    expect(analysis.controls[0].worthIt).toBe(true);
    expect(analysis.controls[1].worthIt).toBe(false);
  });

  it("a control's risk reduction is the loss it removes on its own from its scenarios", () => {
    const sql = analysis.scenarios[0];
    expect(analysis.controls[0].riskReduction).toBeCloseTo(sql.inherent.stats.mean * 0.5, 4);
    expect(analysis.controls[0].roi).toBeCloseTo((sql.inherent.stats.mean * 0.5 - 50_000) / 50_000, 6);
  });

  it('ignores attachments to scenarios that are not in the data', () => {
    const orphan = control({ id: 'orphan', scenarioIds: ['not-a-scenario'], lmReduction: fixed(0.5) });
    const result = analyzeRisk({ scenarios, controls: [orphan], appetite, settings });
    expect(result.controls[0].riskReduction).toBe(0);
    expect(result.controls[0].worthIt).toBe(false);
  });
});

describe('executive summary wording', () => {
  it('writes each risk as one plain sentence', () => {
    const losses = Float64Array.from([0, 0, 0, 0, 0, 0, 0, 3_000_000, 3_000_000, 3_000_000]);
    expect(exceedanceProbability(losses, 2_000_000)).toBe(0.3);
    expect(riskSentence('Ransomware', losses, 2_000_000)).toBe('Ransomware: 30% chance of losing more than $2M this year.');
  });

  it('quotes a round loss figure near the requested odds', () => {
    const losses = Float64Array.from({ length: 1001 }, (_, i) => i * 1_234);
    expect(headlineLoss(losses, 0.1)).toBe(1_100_000);
    expect(headlineLoss(new Float64Array(10), 0.1)).toBe(0);
  });

  it('describes payback in plain words', () => {
    expect(paybackText(null)).toBe('never pays back');
    expect(paybackText(0.01)).toBe('pays back within the first month');
    expect(paybackText(0.5)).toBe('pays back in about 6 months');
    expect(paybackText(2.25)).toBe('pays back in about 2.3 years');
  });

  it('avoids claiming 0% or 100%', () => {
    expect(chanceText(0)).toBe('less than a 1% chance');
    expect(chanceText(1)).toBe('more than a 99% chance');
    expect(chanceText(0.154)).toBe('15% chance');
  });

  it('lists the top risks by expected loss and only worthwhile controls', () => {
    const appetite = { probability: 0.1, lossThreshold: 1_000_000 };
    const controls = [
      control({ id: 'good', name: 'Good', annualCost: 50_000, lmReduction: fixed(0.5) }),
      control({ id: 'bad', name: 'Bad', annualCost: 500_000, lmReduction: fixed(0.5), scenarioIds: ['port-scan'] }),
    ];
    const summary = executiveSummary(analyzeRisk({ scenarios, controls, appetite, settings }));
    expect(summary.topRisks.map((r) => r.id)).toEqual(['sql-injection', 'port-scan']);
    expect(summary.topRisks[0].sentence).toMatch(/^Break-ins to our databases through the website: \d+% chance of losing more than \$[\d.]+[KM] this year\.$/);
    expect(summary.recommended.map((c) => c.id)).toEqual(['good']);
    expect(summary.exposureAfter).toBeLessThan(summary.exposureBefore);
    expect(summary.exposureReduction).toBeCloseTo(summary.exposureBefore - summary.exposureAfter, 6);
  });
});
