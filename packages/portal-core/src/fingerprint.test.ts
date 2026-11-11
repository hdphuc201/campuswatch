import { describe, expect, it } from 'vitest';
import { canonicalizeValue } from './canonical.js';
import { fingerprintEntity, type FingerprintInput } from './fingerprint.js';

const base: FingerprintInput = {
  entityType: 'exam',
  externalKey: '2026-2027|1|CS101|2026-12-20|1',
  payload: { room: 'A101', session: 1, courseName: 'Lập trình' },
};

describe('canonicalizeValue', () => {
  it('normalizes Unicode and collapses whitespace', () => {
    // Decomposed "a" + combining acute accent must equal the precomposed character.
    expect(canonicalizeValue('  Giáo  trình \n')).toBe('Giáo trình');
  });

  it('rejects non-finite numbers', () => {
    expect(() => canonicalizeValue(Number.NaN)).toThrow(RangeError);
  });
});

describe('fingerprintEntity', () => {
  it('returns a SHA-256 hex digest', async () => {
    await expect(fingerprintEntity(base)).resolves.toMatch(/^[0-9a-f]{64}$/);
  });

  it('ignores field order and cosmetic whitespace', async () => {
    const reordered: FingerprintInput = {
      ...base,
      payload: { courseName: ' Lập  trình ', session: 1, room: 'A101' },
    };

    expect(await fingerprintEntity(reordered)).toBe(await fingerprintEntity(base));
  });

  it('changes when a field value changes', async () => {
    const moved: FingerprintInput = { ...base, payload: { ...base.payload, room: 'B202' } };

    expect(await fingerprintEntity(moved)).not.toBe(await fingerprintEntity(base));
  });

  it('changes when the entity identity changes', async () => {
    expect(await fingerprintEntity({ ...base, entityType: 'grade_course' })).not.toBe(
      await fingerprintEntity(base),
    );
  });
});
