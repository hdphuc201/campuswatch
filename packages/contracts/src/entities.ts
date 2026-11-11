import { z } from 'zod';

/** Normalized Portal entity types (implementation plan, section 7). */
export const entityTypeSchema = z.enum([
  'grade_course',
  'grade_summary',
  'tuition_term',
  'tuition_course',
  'timetable_class',
  'exam',
  'portal_notice',
]);

export type EntityType = z.infer<typeof entityTypeSchema>;

/**
 * A canonical field value. Dates are ISO 8601 strings, money is integer VND,
 * scores are numbers or `null` when not yet published.
 */
export const canonicalValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export type CanonicalValue = z.infer<typeof canonicalValueSchema>;

export const canonicalPayloadSchema = z.record(z.string().min(1), canonicalValueSchema);

export type CanonicalPayload = z.infer<typeof canonicalPayloadSchema>;

/** Lowercase hex SHA-256 digest. */
export const fingerprintSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'Expected a SHA-256 hex digest');

/**
 * A normalized entity extracted from the Portal. It never carries raw HTML,
 * cookies, tokens, or credentials.
 */
export const normalizedEntitySchema = z.strictObject({
  entityType: entityTypeSchema,
  externalKey: z.string().trim().min(1).max(512),
  payload: canonicalPayloadSchema,
  fingerprint: fingerprintSchema,
});

export type NormalizedEntity = z.infer<typeof normalizedEntitySchema>;

export const changeKindSchema = z.enum(['ADDED', 'UPDATED', 'REMOVED']);

export type ChangeKind = z.infer<typeof changeKindSchema>;
