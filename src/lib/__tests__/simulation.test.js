import { describe, expect, it } from 'vitest';
import {
  createRng,
  exceedanceCurve,
  exceedanceProbability,
  mean,
  percentile,
  pertMean,
  pertSeries,
  poissonCount,
  simulateAnnualLoss,
  sumLosses,
  summarize,
} from '../simulation';

const scenario = {
  id: 'test-scenario',
  frequency: { min: 20, likely: 40, max: 80 },
  magnitude: { min: 5_000, likely: 10_000, max: 30_000 },
};
const options = { seed: 42, trials: 20_000 };
const fixed = (value) => ({ min: value, likely: value, max: value });

describe('random streams', () => {
  it('is deterministic for a seed and differs between seeds', () => {
    const a = createRng(7);
    const b = createRng(7);
    const c = createRng(8);
    const seqA = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(seqA);
    expect([c(), c(), c()]).not.toEqual(seqA);
    seqA.forEach((value) => expect(value).toBeGreaterThanOrEqual(0) && expect(value).toBeLessThan(1));
  });

  it('PERT draws stay inside the range and average to (min + 4·likely + max) / 6', () => {
    const range = { min: 10, likely: 20, max: 60 };
    const draws = pertSeries(1, 'pert', range, 40_000);
    expect(Math.min(...draws)).toBeGreaterThanOrEqual(10);
    expect(Math.max(...draws)).toBeLessThanOrEqual(60);
    expect(mean(draws)).toBeCloseTo(pertMean(range), 0);
    expect(pertMean(range)).toBeCloseTo(25, 10);
  });

  it('a zero-width range always returns that value', () => {
    expect([...pertSeries(1, 'flat', fixed(5), 3)]).toEqual([5, 5, 5]);
  });

  it('Poisson counts are zero at rate 0, rise with the draw and with the rate, and average to the rate', () => {
    expect(poissonCount(0, 0.5)).toBe(0);
    expect(poissonCount(3, 0.5)).toBeLessThanOrEqual(poissonCount(12, 0.5));
    expect(poissonCount(400, 0.1)).toBeLessThan(poissonCount(400, 0.9));
    expect(poissonCount(690, 0.999)).toBeLessThanOrEqual(poissonCount(710, 0.999));
    const rng = createRng(3);
    for (const rate of [4, 120, 900]) {
      let total = 0;
      for (let i = 0; i < 20_000; i += 1) total += poissonCount(rate, rng());
      expect(Math.abs(total / 20_000 - rate) / rate).toBeLessThan(0.02);
    }
  });
});

describe('simulateAnnualLoss', () => {
  it('returns identical results for the same seed', () => {
    expect(simulateAnnualLoss(scenario, [], options)).toEqual(simulateAnnualLoss(scenario, [], options));
  });

  it('changes with the seed', () => {
    const other = simulateAnnualLoss(scenario, [], { ...options, seed: 43 });
    expect(other).not.toEqual(simulateAnnualLoss(scenario, [], options));
  });

  it('mean annual loss is close to mean frequency × mean magnitude', () => {
    const expected = pertMean(scenario.frequency) * pertMean(scenario.magnitude);
    const simulated = mean(simulateAnnualLoss(scenario, [], options));
    expect(Math.abs(simulated - expected) / expected).toBeLessThan(0.03);
  });

  it('a control with zero effect leaves every simulated year unchanged (same random draws)', () => {
    const noEffect = { id: 'noop', lefReduction: fixed(0), lmReduction: fixed(0) };
    expect(simulateAnnualLoss(scenario, [noEffect], options)).toEqual(simulateAnnualLoss(scenario, [], options));
  });

  it('a magnitude-only control scales every simulated year by exactly (1 − reduction)', () => {
    const before = simulateAnnualLoss(scenario, [], options);
    const after = simulateAnnualLoss(scenario, [{ id: 'lm', lefReduction: fixed(0), lmReduction: fixed(0.25) }], options);
    for (let i = 0; i < 200; i += 1) expect(after[i]).toBeCloseTo(before[i] * 0.75, 6);
  });

  it('a frequency control never increases the loss in any simulated year', () => {
    const before = simulateAnnualLoss(scenario, [], options);
    const after = simulateAnnualLoss(scenario, [{ id: 'lef', lefReduction: { min: 0.2, likely: 0.4, max: 0.6 }, lmReduction: fixed(0) }], options);
    for (let i = 0; i < before.length; i += 1) expect(after[i]).toBeLessThanOrEqual(before[i]);
    expect(mean(after) / mean(before)).toBeCloseTo(0.6, 1);
  });

  it('several controls stack multiplicatively', () => {
    const half = (id) => ({ id, lefReduction: fixed(0), lmReduction: fixed(0.5) });
    const before = mean(simulateAnnualLoss(scenario, [], options));
    const after = mean(simulateAnnualLoss(scenario, [half('a'), half('b')], options));
    expect(after / before).toBeCloseTo(0.25, 6);
  });

  it('a 100% frequency reduction removes all loss', () => {
    const total = { id: 'all', lefReduction: fixed(1), lmReduction: fixed(0) };
    expect(mean(simulateAnnualLoss(scenario, [total], options))).toBe(0);
  });
});

describe('statistics', () => {
  const losses = Float64Array.from([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);

  it('percentile interpolates on sorted data', () => {
    expect(percentile(losses, 0.5)).toBe(50);
    expect(percentile(losses, 0.9)).toBe(90);
    expect(percentile(losses, 0.95)).toBe(95);
    expect(percentile([], 0.5)).toBe(0);
  });

  it('exceedance probability counts years strictly above the amount', () => {
    expect(exceedanceProbability(losses, 50)).toBeCloseTo(5 / 11, 10);
    expect(exceedanceProbability(losses, 100)).toBe(0);
    expect(exceedanceProbability(losses, -1)).toBe(1);
  });

  it('summarize reports mean, median, P90, P95 and threshold exceedance', () => {
    const stats = summarize(losses, 85);
    expect(stats.mean).toBe(50);
    expect(stats.median).toBe(50);
    expect(stats.p90).toBe(90);
    expect(stats.p95).toBe(95);
    expect(stats.exceedProbability).toBeCloseTo(2 / 11, 10);
    expect(summarize(losses).exceedProbability).toBeNull();
  });

  it('the exceedance curve starts high, never rises, and matches exceedanceProbability', () => {
    const curve = exceedanceCurve(losses, { points: 10 });
    expect(curve).toHaveLength(11);
    expect(curve[0]).toEqual({ loss: 0, probability: 10 / 11 });
    expect(curve[10].probability).toBe(0);
    for (let i = 1; i < curve.length; i += 1) expect(curve[i].probability).toBeLessThanOrEqual(curve[i - 1].probability);
    curve.forEach((point) => expect(point.probability).toBeCloseTo(exceedanceProbability(losses, point.loss), 10));
  });

  it('sumLosses adds scenarios year by year', () => {
    expect([...sumLosses([Float64Array.from([1, 2]), Float64Array.from([10, 20])])]).toEqual([11, 22]);
  });
});
