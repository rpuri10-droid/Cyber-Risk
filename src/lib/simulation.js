// Seeded FAIR-style Monte Carlo engine. Pure functions only: no React, no storage.
//
// One trial = one simulated year. For each year the engine draws
//   - an annual event frequency from PERT(min, likely, max), then a Poisson count around it
//   - an average loss per event from PERT(min, likely, max)
//   - for every attached control, a % reduction of frequency and of magnitude
// and returns frequency × magnitude as that year's loss.
//
// Every random variable has its own stream, seeded from (seed, label). That gives
// "common random numbers": the before-controls and after-controls runs see exactly
// the same simulated years, so the difference between them is the controls alone.

export const DEFAULT_TRIALS = 10_000;
export const DEFAULT_SEED = 20_260_101;

/** Small fast deterministic PRNG (mulberry32). Returns a function yielding [0, 1). */
export function createRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Derives an independent stream seed from a base seed and a label (FNV-1a). */
export function deriveSeed(seed, label) {
  let hash = (2_166_136_261 ^ (seed >>> 0)) >>> 0;
  const text = String(label);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  return hash >>> 0;
}

function standardNormal(rng) {
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// Marsaglia–Tsang; valid for shape >= 1, which PERT always satisfies.
function sampleGamma(rng, shape) {
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    const x = standardNormal(rng);
    const v = (1 + c * x) ** 3;
    if (v <= 0) continue;
    const u = Math.max(rng(), 1e-12);
    if (Math.log(u) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v;
  }
}

/** Cleans a {min, likely, max} range: nothing negative, and the three values in ascending order. */
export function normalizeRange(range) {
  const [min, likely, max] = [range?.min, range?.likely, range?.max]
    .map((v) => Math.max(0, Number(v) || 0))
    .sort((x, y) => x - y);
  return { min, likely, max };
}

export const pertMean = (range) => {
  const { min, likely, max } = normalizeRange(range);
  return (min + 4 * likely + max) / 6;
};

/** One draw from a (modified, lambda = 4) PERT distribution. */
export function samplePert(rng, range) {
  const { min, likely, max } = normalizeRange(range);
  const width = max - min;
  if (width <= 0) return min;
  const alpha = 1 + (4 * (likely - min)) / width;
  const beta = 1 + (4 * (max - likely)) / width;
  const a = sampleGamma(rng, alpha);
  const b = sampleGamma(rng, beta);
  return min + (a / (a + b)) * width;
}

/**
 * `trials` PERT draws from the stream identified by (seed, label). Pass a Map as `cache`
 * to reuse a stream across several runs instead of regenerating it.
 */
export function pertSeries(seed, label, range, trials, cache) {
  const clean = normalizeRange(range);
  const key = `${seed}|${trials}|${label}|${clean.min}|${clean.likely}|${clean.max}`;
  if (cache?.has(key)) return cache.get(key);
  const rng = createRng(deriveSeed(seed, label));
  const out = new Float64Array(trials);
  for (let i = 0; i < trials; i += 1) out[i] = samplePert(rng, clean);
  cache?.set(key, out);
  return out;
}

// Inverse of the standard normal CDF (Acklam's rational approximation).
function inverseNormal(p) {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const u = Math.min(1 - 1e-12, Math.max(1e-12, p));
  if (u < 0.02425 || u > 1 - 0.02425) {
    const q = Math.sqrt(-2 * Math.log(u < 0.5 ? u : 1 - u));
    const x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    return u < 0.5 ? x : -x;
  }
  const q = u - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/**
 * Poisson quantile: the event count for rate `lambda` at uniform draw `u`. Taking the
 * count from a pre-drawn `u` lets the same draw be reused with a lower rate, and a lower
 * rate can then never produce a higher count.
 */
export function poissonCount(lambda, u) {
  if (!(lambda > 0)) return 0;
  if (lambda >= 700) {
    // exp(-lambda) underflows; use the normal approximation with a skewness correction.
    const z = inverseNormal(u);
    return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * z + (z * z - 1) / 6));
  }
  let k = 0;
  let p = Math.exp(-lambda);
  let cumulative = p;
  const limit = lambda + 12 * Math.sqrt(lambda) + 30;
  while (u > cumulative && k < limit) {
    k += 1;
    p *= lambda / k;
    cumulative += p;
  }
  return k;
}

/**
 * Simulates annual losses for one scenario.
 *
 * scenario: { id, frequency: {min, likely, max} events/year, magnitude: {min, likely, max} USD/event }
 * controls: [{ id, lefReduction: {min, likely, max}, lmReduction: {min, likely, max} }] as fractions 0-1.
 *           Several controls stack multiplicatively: remaining = Π (1 − reduction).
 * options:  { seed, trials, cache } where cache is an optional Map shared between runs.
 * Returns a Float64Array with one annual loss per trial.
 */
export function simulateAnnualLoss(scenario, controls = [], { seed = DEFAULT_SEED, trials = DEFAULT_TRIALS, cache } = {}) {
  const frequency = pertSeries(seed, `${scenario.id}|frequency`, scenario.frequency, trials, cache);
  const magnitude = pertSeries(seed, `${scenario.id}|magnitude`, scenario.magnitude, trials, cache);
  const countRng = createRng(deriveSeed(seed, `${scenario.id}|count`));
  // A control's effectiveness is one uncertain fact about that control, so its stream is
  // keyed by the control alone and is the same in every scenario and every comparison.
  const effects = controls.map((control) => ({
    lef: pertSeries(seed, `${control.id}|lef`, control.lefReduction, trials, cache),
    lm: pertSeries(seed, `${control.id}|lm`, control.lmReduction, trials, cache),
  }));

  const losses = new Float64Array(trials);
  for (let i = 0; i < trials; i += 1) {
    const u = countRng();
    let rate = frequency[i];
    let perEvent = magnitude[i];
    for (const effect of effects) {
      rate *= 1 - Math.min(1, effect.lef[i]);
      perEvent *= 1 - Math.min(1, effect.lm[i]);
    }
    losses[i] = poissonCount(rate, u) * perEvent;
  }
  return losses;
}

/** Trial-by-trial sum of several loss arrays (portfolio aggregation). */
export function sumLosses(lossArrays, trials = lossArrays[0]?.length || 0) {
  const total = new Float64Array(trials);
  for (const losses of lossArrays) {
    for (let i = 0; i < trials; i += 1) total[i] += losses[i];
  }
  return total;
}

export function mean(values) {
  if (values.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) sum += values[i];
  return sum / values.length;
}

/** Linear-interpolated percentile (p in 0-1) of an ascending-sorted array. */
export function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const position = Math.min(1, Math.max(0, p)) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

/** Share of simulated years whose loss is strictly greater than `amount`. */
export function exceedanceProbability(losses, amount) {
  if (losses.length === 0) return 0;
  let count = 0;
  for (let i = 0; i < losses.length; i += 1) if (losses[i] > amount) count += 1;
  return count / losses.length;
}

/**
 * Loss exceedance curve: [{ loss, probability }] where probability = P(annual loss > loss),
 * sampled at evenly spaced loss amounts from 0 to `maxLoss` (default: the largest simulated loss).
 */
export function exceedanceCurve(losses, { points = 80, maxLoss } = {}) {
  const sorted = Float64Array.from(losses).sort();
  const n = sorted.length;
  const top = maxLoss ?? (n ? sorted[n - 1] : 0);
  const curve = [];
  let index = 0;
  for (let step = 0; step <= points; step += 1) {
    const loss = (top * step) / points;
    while (index < n && sorted[index] <= loss) index += 1;
    curve.push({ loss, probability: n ? (n - index) / n : 0 });
  }
  return curve;
}

/** Headline statistics for a set of simulated annual losses. */
export function summarize(losses, thresholdLoss) {
  const sorted = Float64Array.from(losses).sort();
  return {
    mean: mean(losses),
    median: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted.length ? sorted[sorted.length - 1] : 0,
    exceedProbability: thresholdLoss == null ? null : exceedanceProbability(losses, thresholdLoss),
  };
}
