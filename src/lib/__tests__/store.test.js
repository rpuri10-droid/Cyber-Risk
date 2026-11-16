import { describe, expect, it } from 'vitest';
import { SEED_CONTROLS } from '../seedControls';
import {
  DEFAULT_ASSUMPTIONS,
  LEGACY_STORAGE_KEY,
  STATE_VERSION,
  STORAGE_KEY,
  defaultState,
  loadState,
  migrateState,
  normalizeControl,
  saveState,
} from '../store';

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    data,
  };
}

describe('saved-state migration', () => {
  it('starts new users on the demo data', () => {
    const state = migrateState(null, null);
    expect(state.version).toBe(STATE_VERSION);
    expect(state.controls).toHaveLength(SEED_CONTROLS.length);
    expect(state.controls.length).toBeGreaterThanOrEqual(5);
    expect(state.appetite).toEqual({ probability: 0.1, lossThreshold: 1_000_000 });
  });

  it('keeps v1 assumptions when upgrading to v2', () => {
    const v1 = { controlEffectiveness: 0.35, lossPerEvent: { ddos: 9_999 } };
    const state = migrateState(null, v1);
    expect(state.assumptions.controlEffectiveness).toBe(0.35);
    expect(state.assumptions.lossPerEvent.ddos).toBe(9_999);
    expect(state.assumptions.lossPerEvent.xss).toBe(DEFAULT_ASSUMPTIONS.lossPerEvent.xss);
    expect(state.controls).toHaveLength(SEED_CONTROLS.length);
  });

  it('prefers the v2 document over the legacy one and keeps user edits', () => {
    const saved = { ...defaultState(), controls: [], appetite: { probability: 0.05, lossThreshold: 250_000 } };
    const state = migrateState(saved, { controlEffectiveness: 0.1, lossPerEvent: {} });
    expect(state.controls).toEqual([]);
    expect(state.appetite).toEqual({ probability: 0.05, lossThreshold: 250_000 });
    expect(state.assumptions.controlEffectiveness).toBe(0.6);
  });

  it('repairs bad values instead of crashing', () => {
    const state = migrateState({ version: 2, appetite: { probability: 7, lossThreshold: -5 }, controls: 'oops', settings: { amortizationYears: 0 } });
    expect(state.appetite.probability).toBe(0.99);
    expect(state.appetite.lossThreshold).toBe(1_000_000);
    expect(state.controls).toHaveLength(SEED_CONTROLS.length);
    expect(state.settings.amortizationYears).toBe(3);
  });

  it('normalizes controls: ordered ranges, fractions capped at 100%, no negative costs', () => {
    const control = normalizeControl({
      id: 'x',
      name: '  ',
      annualCost: -10,
      implementationCost: '2500',
      lefReduction: { min: 0.9, likely: 0.2, max: 4 },
      scenarioIds: ['a', 'a', 'b'],
    });
    expect(control.name).toBe('Untitled control');
    expect(control.annualCost).toBe(0);
    expect(control.implementationCost).toBe(2500);
    expect(control.lefReduction).toEqual({ min: 0.2, likely: 0.9, max: 1 });
    expect(control.lmReduction).toEqual({ min: 0, likely: 0, max: 0 });
    expect(control.scenarioIds).toEqual(['a', 'b']);
  });
});

describe('storage', () => {
  it('reads the legacy key, writes the new key and leaves the legacy data in place', () => {
    const legacy = JSON.stringify({ controlEffectiveness: 0.42, lossPerEvent: { c2: 1 } });
    const storage = memoryStorage({ [LEGACY_STORAGE_KEY]: legacy });
    const state = loadState(storage);
    expect(state.assumptions.controlEffectiveness).toBe(0.42);
    saveState(state, storage);
    expect(storage.data.get(LEGACY_STORAGE_KEY)).toBe(legacy);
    expect(loadState(storage)).toEqual(state);
    expect(JSON.parse(storage.data.get(STORAGE_KEY)).version).toBe(STATE_VERSION);
  });

  it('falls back to defaults on corrupt JSON', () => {
    const storage = memoryStorage({ [STORAGE_KEY]: '{not json' });
    expect(loadState(storage)).toEqual(defaultState());
  });
});
