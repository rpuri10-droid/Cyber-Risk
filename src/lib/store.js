// Persistence. The app has no server or database: saved state lives in the browser's
// localStorage as one versioned document, and `migrateState` plays the role of a schema
// migration so data saved by older versions keeps working.

import { ATTACK_PROFILES } from './analytics';
import { DEFAULT_APPETITE, DEFAULT_SETTINGS } from './risk';
import { SEED_CONTROLS } from './seedControls';
import { normalizeRange } from './simulation';

export const STATE_VERSION = 2;
export const STORAGE_KEY = 'cyber-risk-state';
// v1 stored only { controlEffectiveness, lossPerEvent } under this key. It is read once
// and left untouched, so rolling back to the old build still finds its data.
export const LEGACY_STORAGE_KEY = 'cyber-risk-assumptions-v1';

export const DEFAULT_ASSUMPTIONS = {
  controlEffectiveness: 0.6,
  lossPerEvent: Object.fromEntries(Object.entries(ATTACK_PROFILES).map(([type, p]) => [type, p.lossPerEvent])),
};

const money = (value) => Math.max(0, Number(value) || 0);
const fraction = (value) => Math.min(1, Math.max(0, Number(value) || 0));

function reductionRange(range) {
  const clean = normalizeRange(range || {});
  return { min: fraction(clean.min), likely: fraction(clean.likely), max: fraction(clean.max) };
}

export function normalizeControl(control) {
  return {
    id: String(control.id || `control-${Date.now().toString(36)}`),
    name: String(control.name || 'Untitled control').trim() || 'Untitled control',
    description: String(control.description || ''),
    annualCost: money(control.annualCost),
    implementationCost: money(control.implementationCost),
    lefReduction: reductionRange(control.lefReduction),
    lmReduction: reductionRange(control.lmReduction),
    scenarioIds: Array.isArray(control.scenarioIds) ? [...new Set(control.scenarioIds.map(String))] : [],
  };
}

function mergeAssumptions(saved) {
  const control = saved?.controlEffectiveness;
  return {
    controlEffectiveness: typeof control === 'number' ? fraction(control) : DEFAULT_ASSUMPTIONS.controlEffectiveness,
    lossPerEvent: { ...DEFAULT_ASSUMPTIONS.lossPerEvent, ...(saved?.lossPerEvent || {}) },
  };
}

export function defaultState() {
  return {
    version: STATE_VERSION,
    assumptions: mergeAssumptions(null),
    scenarioRanges: {},
    controls: SEED_CONTROLS.map(normalizeControl),
    appetite: { ...DEFAULT_APPETITE },
    settings: { ...DEFAULT_SETTINGS },
  };
}

// One step per schema version; each takes the previous shape and returns the next.
const MIGRATIONS = {
  // v1 -> v2: wrap the bare assumptions object and add controls, appetite and settings.
  1: (v1) => ({ ...defaultState(), assumptions: mergeAssumptions(v1) }),
};

/**
 * Upgrades any previously saved document to the current shape without losing user data.
 * `saved` is the parsed v2+ document (or null); `legacy` is the parsed v1 document (or null).
 */
export function migrateState(saved, legacy = null) {
  let state = saved;
  if (!state || typeof state !== 'object') {
    if (!legacy || typeof legacy !== 'object') return defaultState();
    state = { ...legacy, version: 1 };
  }
  let version = Number(state.version) || 1;
  while (version < STATE_VERSION) {
    state = MIGRATIONS[version](state);
    version += 1;
  }

  const base = defaultState();
  const appetite = state.appetite || {};
  const settings = state.settings || {};
  return {
    version: STATE_VERSION,
    assumptions: mergeAssumptions(state.assumptions),
    scenarioRanges: state.scenarioRanges && typeof state.scenarioRanges === 'object' ? state.scenarioRanges : {},
    controls: Array.isArray(state.controls) ? state.controls.map(normalizeControl) : base.controls,
    appetite: {
      probability: Math.min(0.99, Math.max(0.01, Number(appetite.probability) || base.appetite.probability)),
      lossThreshold: money(appetite.lossThreshold) || base.appetite.lossThreshold,
    },
    settings: {
      ...base.settings,
      amortizationYears: Math.min(10, Math.max(1, Math.round(Number(settings.amortizationYears) || base.settings.amortizationYears))),
    },
  };
}

function readJson(storage, key) {
  try {
    return JSON.parse(storage.getItem(key));
  } catch {
    return null; // unavailable or corrupt: treated as "nothing saved"
  }
}

export function loadState(storage = globalThis.localStorage) {
  if (!storage) return defaultState();
  return migrateState(readJson(storage, STORAGE_KEY), readJson(storage, LEGACY_STORAGE_KEY));
}

export function saveState(state, storage = globalThis.localStorage) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore storage failures (private mode, quota)
  }
}
