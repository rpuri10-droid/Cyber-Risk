// Risk service layer: scenarios, controls, ROI, risk appetite and the executive summary.
// Everything the new pages display is computed here; components only render the result.

import { formatUsdShort } from './analytics';
import {
  DEFAULT_SEED,
  DEFAULT_TRIALS,
  exceedanceCurve,
  exceedanceProbability,
  mean,
  normalizeRange,
  percentile,
  simulateAnnualLoss,
  sumLosses,
  summarize,
} from './simulation';

// Uncertainty around the point estimates, as multiples of the "most likely" value.
export const DEFAULT_SCENARIO_RANGE = { freqLow: 0.6, freqHigh: 1.5, lossLow: 0.5, lossHigh: 2.2 };

export const DEFAULT_APPETITE = { probability: 0.1, lossThreshold: 1_000_000 };

export const DEFAULT_SETTINGS = { amortizationYears: 3, trials: DEFAULT_TRIALS, seed: DEFAULT_SEED };

// Jargon-free names used on the executive summary.
const PLAIN_NAMES = {
  c2: 'Malware taking remote control of our systems',
  'command-injection': 'Attackers running their own commands on our servers',
  'exploit-attempt': 'Attacks on unpatched software',
  'sql-injection': 'Break-ins to our databases through the website',
  'credential-stuffing': 'Logins with stolen passwords',
  ddos: 'Traffic floods knocking services offline',
  'brute-force': 'Password-guessing attacks',
  xss: 'Malicious code planted in our web pages',
  'port-scan': 'Outsiders probing our network for weak points',
};

export const plainName = (id, fallback) => PLAIN_NAMES[id] || fallback || id;

/**
 * Turns the dashboard's per-attack-type figures into FAIR scenarios.
 * attackTypes: computeMetrics(...).attackTypes; ranges: { [scenarioId]: partial DEFAULT_SCENARIO_RANGE }.
 */
export function buildScenarios(attackTypes, ranges = {}) {
  return attackTypes.map((item) => {
    const range = { ...DEFAULT_SCENARIO_RANGE, ...ranges[item.type] };
    return {
      id: item.type,
      name: item.label,
      plainName: plainName(item.type, item.label),
      severity: item.severity,
      observed: item.count,
      range,
      frequency: normalizeRange({
        min: item.annualFrequency * range.freqLow,
        likely: item.annualFrequency,
        max: item.annualFrequency * range.freqHigh,
      }),
      magnitude: normalizeRange({
        min: item.lossPerEvent * range.lossLow,
        likely: item.lossPerEvent,
        max: item.lossPerEvent * range.lossHigh,
      }),
    };
  });
}

/** Combined effect of several independent reductions (fractions 0-1): 1 − Π(1 − r). */
export function combineReductions(reductions) {
  return 1 - reductions.reduce((remaining, r) => remaining * (1 - Math.min(1, Math.max(0, r))), 1);
}

/** Risk reduction = inherent ALE − residual ALE (never reported below zero). */
export function riskReduction(inherentAle, residualAle) {
  return Math.max(0, inherentAle - residualAle);
}

/**
 * Control economics.
 *   annualized cost = annual cost + implementation cost / amortization years
 *   ROI             = (risk reduction − annualized cost) / annualized cost
 *   payback (years) = implementation cost / (risk reduction − annual cost); null = never pays back
 *   worth it        = ROI > 0
 */
export function controlRoi({ riskReduction: reduction, annualCost, implementationCost, amortizationYears = 3 }) {
  const years = Math.max(1, Number(amortizationYears) || 1);
  const running = Math.max(0, Number(annualCost) || 0);
  const upfront = Math.max(0, Number(implementationCost) || 0);
  const annualizedCost = running + upfront / years;
  const netBenefit = reduction - annualizedCost;
  const roi = annualizedCost > 0 ? netBenefit / annualizedCost : reduction > 0 ? Infinity : 0;
  const netAnnualSaving = reduction - running;
  const paybackYears = netAnnualSaving > 0 ? upfront / netAnnualSaving : null;
  return {
    annualizedCost,
    netBenefit,
    roi,
    paybackYears,
    returnPerDollar: annualizedCost > 0 ? reduction / annualizedCost : null,
    worthIt: roi > 0,
  };
}

/**
 * Appetite: "no more than `probability` chance of losing more than `lossThreshold` per year".
 * A loss curve crosses the threshold when its exceedance probability at that loss is higher.
 */
export function exceedsAppetite(exceedProbability, appetite) {
  return exceedProbability > appetite.probability;
}

function profile(losses, appetite, maxLoss) {
  const stats = summarize(losses, appetite.lossThreshold);
  return {
    losses,
    stats,
    curve: exceedanceCurve(losses, { maxLoss }),
    overAppetite: exceedsAppetite(stats.exceedProbability, appetite),
  };
}

// Shared x-axis extent for a before/after pair: the 99th percentile of the larger curve,
// stretched to include the appetite threshold unless that would squash the curves.
function axisMax(inherentLosses, appetite) {
  const p99 = summarize(inherentLosses).p99 || 1;
  const base = p99 * 1.08;
  const wanted = appetite.lossThreshold * 1.15;
  return wanted > base && wanted <= base * 3 ? wanted : base;
}

function compare(inherentLosses, residualLosses, appetite) {
  const maxLoss = axisMax(inherentLosses, appetite);
  const inherent = profile(inherentLosses, appetite, maxLoss);
  const residual = profile(residualLosses, appetite, maxLoss);
  return {
    inherent,
    residual,
    maxLoss,
    riskReduction: riskReduction(inherent.stats.mean, residual.stats.mean),
  };
}

/**
 * Runs the whole model: every scenario before and after its attached controls, the
 * portfolio total, appetite flags and the ROI ranking of controls.
 */
export function analyzeRisk({ scenarios, controls = [], appetite = DEFAULT_APPETITE, settings = DEFAULT_SETTINGS }) {
  const options = { seed: settings.seed, trials: settings.trials, cache: new Map() };
  const byId = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
  const inherentLosses = new Map(scenarios.map((s) => [s.id, simulateAnnualLoss(s, [], options)]));

  const scenarioResults = scenarios.map((scenario) => {
    const attached = controls.filter((control) => control.scenarioIds.includes(scenario.id));
    const before = inherentLosses.get(scenario.id);
    const after = attached.length ? simulateAnnualLoss(scenario, attached, options) : before;
    return {
      ...scenario,
      controls: attached,
      ...compare(before, after, appetite),
    };
  });
  scenarioResults.forEach((s) => {
    s.flagged = s.residual.overAppetite;
  });

  const portfolio = compare(
    sumLosses(scenarioResults.map((s) => s.inherent.losses), settings.trials),
    sumLosses(scenarioResults.map((s) => s.residual.losses), settings.trials),
    appetite,
  );

  // Each control is judged on its own: the loss it removes from the scenarios it is
  // attached to if it were the only control in place.
  const controlResults = controls
    .map((control) => {
      const covered = control.scenarioIds.map((id) => byId.get(id)).filter(Boolean);
      const reduction = covered.reduce((sum, scenario) => {
        const before = mean(inherentLosses.get(scenario.id));
        const after = mean(simulateAnnualLoss(scenario, [control], options));
        return sum + riskReduction(before, after);
      }, 0);
      return {
        ...control,
        scenarios: covered.map((s) => ({ id: s.id, name: s.name })),
        riskReduction: reduction,
        ...controlRoi({
          riskReduction: reduction,
          annualCost: control.annualCost,
          implementationCost: control.implementationCost,
          amortizationYears: settings.amortizationYears,
        }),
      };
    })
    .sort((a, b) => b.roi - a.roi || b.riskReduction - a.riskReduction);

  return {
    appetite,
    settings,
    scenarios: scenarioResults,
    portfolio,
    controls: controlResults,
    flaggedCount: scenarioResults.filter((s) => s.flagged).length,
    flaggedBeforeCount: scenarioResults.filter((s) => s.inherent.overAppetite).length,
  };
}

// --- Plain-English wording for the executive summary

export function chanceText(probability) {
  if (probability < 0.01) return 'less than a 1% chance';
  if (probability > 0.99) return 'more than a 99% chance';
  return `${Math.round(probability * 100)}% chance`;
}

/** e.g. "Ransomware: 15% chance of losing more than $2M this year." */
export function riskSentence(name, losses, amount) {
  return `${name}: ${chanceText(exceedanceProbability(losses, amount))} of losing more than ${formatUsdShort(amount)} this year.`;
}

/**
 * A round loss figure to quote for a risk: the loss that is exceeded in roughly
 * `probability` of simulated years, rounded to two significant figures.
 */
export function headlineLoss(losses, probability) {
  const amount = percentile(Float64Array.from(losses).sort(), 1 - probability);
  if (!(amount > 0)) return 0;
  const unit = 10 ** (Math.floor(Math.log10(amount)) - 1);
  return Math.round(amount / unit) * unit;
}

export function paybackText(years) {
  if (years == null) return 'never pays back';
  const months = years * 12;
  if (months < 1) return 'pays back within the first month';
  if (months < 11.5) return `pays back in about ${Math.round(months)} month${Math.round(months) === 1 ? '' : 's'}`;
  return `pays back in about ${years.toFixed(1)} years`;
}

export function controlSentence(control) {
  const perDollar = control.returnPerDollar;
  const ratio = perDollar == null ? '' : ` That is about $${perDollar >= 10 ? Math.round(perDollar) : perDollar.toFixed(1)} of avoided loss for every $1 spent, and it ${paybackText(control.paybackYears)}.`;
  return `Costs ${formatUsdShort(control.annualizedCost)} a year and is expected to avoid ${formatUsdShort(control.riskReduction)} a year in losses.${ratio}`;
}

/** Everything the executive summary page shows, already worded. */
export function executiveSummary(analysis) {
  const { appetite, portfolio, scenarios, controls } = analysis;
  const topRisks = [...scenarios]
    .sort((a, b) => b.residual.stats.mean - a.residual.stats.mean)
    .slice(0, 5)
    .map((scenario) => ({
      id: scenario.id,
      name: scenario.plainName,
      expectedLoss: scenario.residual.stats.mean,
      expectedLossBefore: scenario.inherent.stats.mean,
      flagged: scenario.flagged,
      sentence: riskSentence(
        scenario.plainName,
        scenario.residual.losses,
        headlineLoss(scenario.residual.losses, appetite.probability),
      ),
    }));
  const recommended = controls
    .filter((control) => control.worthIt)
    .slice(0, 3)
    .map((control) => ({ id: control.id, name: control.name, roi: control.roi, sentence: controlSentence(control) }));
  const before = portfolio.inherent.stats.mean;
  const after = portfolio.residual.stats.mean;
  return {
    exposureBefore: before,
    exposureAfter: after,
    exposureReduction: before - after,
    exposureReductionShare: before > 0 ? (before - after) / before : 0,
    badYearBefore: portfolio.inherent.stats.p90,
    badYearAfter: portfolio.residual.stats.p90,
    scenarioCount: scenarios.length,
    flaggedCount: analysis.flaggedCount,
    flaggedBeforeCount: analysis.flaggedBeforeCount,
    flaggedNames: scenarios.filter((s) => s.flagged).map((s) => s.plainName),
    appetiteSentence: `We accept no more than a ${Math.round(appetite.probability * 100)}% chance of losing more than ${formatUsdShort(appetite.lossThreshold)} in a year from any single type of attack.`,
    topRisks,
    recommended,
  };
}
