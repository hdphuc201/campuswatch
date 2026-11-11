import { describe, expect, it } from 'vitest';
import { normalizedEntitySchema } from './entities.js';

const validEntity = {
  entityType: 'grade_course',
  externalKey: '2026-2027|1|CS101|CS101.01',
  payload: { courseName: 'Intro to Programming', credits: 3, finalScore: null },
  fingerprint: 'a'.repeat(64),
};

describe('normalizedEntitySchema', () => {
  it('accepts a normalized entity', () => {
    expect(normalizedEntitySchema.parse(validEntity)).toEqual(validEntity);
  });

  it('rejects unknown entity types', () => {
    expect(normalizedEntitySchema.safeParse({ ...validEntity, entityType: 'cookie' }).success).toBe(
      false,
    );
  });

  it('rejects nested payload values so raw structures cannot leak through', () => {
    const result = normalizedEntitySchema.safeParse({
      ...validEntity,
      payload: { html: { body: '<table></table>' } },
    });

    expect(result.success).toBe(false);
  });

  it('rejects extra top-level fields', () => {
    const result = normalizedEntitySchema.safeParse({ ...validEntity, rawHtml: '<html></html>' });

    expect(result.success).toBe(false);
  });

  it('rejects malformed fingerprints', () => {
    expect(normalizedEntitySchema.safeParse({ ...validEntity, fingerprint: 'abc' }).success).toBe(
      false,
    );
  });

  it('rejects page markup in values but allows ordinary text with angle brackets', () => {
    const withValue = (value: string) => ({ ...validEntity, payload: { note: value } });
    expect(normalizedEntitySchema.safeParse(withValue('<td>8,5</td>')).success).toBe(false);
    expect(normalizedEntitySchema.safeParse(withValue('<script>x</script>')).success).toBe(false);
    expect(normalizedEntitySchema.safeParse(withValue('score < 5 means fail')).success).toBe(true);
  });

  it('limits value length and the number of fields', () => {
    expect(
      normalizedEntitySchema.safeParse({ ...validEntity, payload: { note: 'x'.repeat(4001) } })
        .success,
    ).toBe(false);
    const wide = Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`f${i}`, i]));
    expect(normalizedEntitySchema.safeParse({ ...validEntity, payload: wide }).success).toBe(false);
  });
});
