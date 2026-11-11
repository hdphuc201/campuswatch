import { describe, expect, it } from 'vitest';
import { PORTAL_DATA_SOURCES } from './adapter.js';
import { citdCapabilities } from './citd.js';

describe('citdCapabilities', () => {
  it('declares a read-only adapter that is not yet verified against the live Portal', () => {
    expect(citdCapabilities.adapterKey).toBe('citd');
    expect(citdCapabilities.readOnly).toBe(true);
    expect(citdCapabilities.implementationStatus).toBe('implemented');
    expect(citdCapabilities.liveVerified).toBe(false);
  });

  it('supports every data source in the plan', () => {
    expect(Object.keys(citdCapabilities.sources).sort()).toEqual([...PORTAL_DATA_SOURCES].sort());
    expect(new Set(Object.values(citdCapabilities.sources))).toEqual(new Set(['supported']));
  });

  it('cannot be mutated at runtime', () => {
    expect(Object.isFrozen(citdCapabilities)).toBe(true);
    expect(Object.isFrozen(citdCapabilities.sources)).toBe(true);
  });
});
