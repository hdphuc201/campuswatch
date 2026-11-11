import { describe, expect, it } from 'vitest';
import { PORTAL_DATA_SOURCES } from './adapter.js';
import { citdCapabilities } from './citd.js';

describe('citdCapabilities', () => {
  it('declares a read-only, not yet implemented adapter', () => {
    expect(citdCapabilities.adapterKey).toBe('citd');
    expect(citdCapabilities.readOnly).toBe(true);
    expect(citdCapabilities.implementationStatus).toBe('unimplemented');
  });

  it('lists every data source as planned until collectors exist', () => {
    expect(Object.keys(citdCapabilities.sources).sort()).toEqual([...PORTAL_DATA_SOURCES].sort());
    expect(new Set(Object.values(citdCapabilities.sources))).toEqual(new Set(['planned']));
  });

  it('cannot be mutated at runtime', () => {
    expect(Object.isFrozen(citdCapabilities)).toBe(true);
    expect(Object.isFrozen(citdCapabilities.sources)).toBe(true);
  });
});
