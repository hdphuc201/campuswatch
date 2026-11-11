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
});
