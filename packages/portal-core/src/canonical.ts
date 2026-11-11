import type { CanonicalPayload, CanonicalValue } from '@campuswatch/contracts';

/**
 * Canonicalizes a single value so that cosmetic differences (Unicode form,
 * surrounding or repeated whitespace) do not produce a different fingerprint.
 *
 * Source-specific rules (ISO dates, integer VND, numeric scores) belong to the
 * adapter normalizers added in P4/P5.
 */
export function canonicalizeValue(value: CanonicalValue): CanonicalValue {
  if (typeof value === 'string') {
    return value.normalize('NFC').replace(/\s+/g, ' ').trim();
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new RangeError('Canonical numbers must be finite');
  }
  return value;
}

/** Returns `[field, value]` pairs sorted by field name, with canonicalized values. */
export function canonicalEntries(payload: CanonicalPayload): [string, CanonicalValue][] {
  return Object.entries(payload)
    .map(([field, value]): [string, CanonicalValue] => [field, canonicalizeValue(value)])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}
