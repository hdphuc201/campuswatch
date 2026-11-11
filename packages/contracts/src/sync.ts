import { z } from 'zod';
import { portalConnectionSchema } from './connection.js';
import {
  canonicalPayloadSchema,
  canonicalValueSchema,
  changeKindSchema,
  type EntityType,
  entityTypeSchema,
  normalizedEntitySchema,
} from './entities.js';

/** Portal data sources, in planned implementation order (plan section 13, P4). */
export const PORTAL_DATA_SOURCES = [
  'grades',
  'tuition',
  'timetable',
  'exams',
  'dashboardNotices',
] as const;

export const portalDataSourceSchema = z.enum(PORTAL_DATA_SOURCES);

export type PortalDataSource = z.infer<typeof portalDataSourceSchema>;

/** Which entity types each source may produce. */
export const SOURCE_ENTITY_TYPES: Readonly<Record<PortalDataSource, readonly EntityType[]>> = {
  grades: ['grade_course', 'grade_summary'],
  tuition: ['tuition_term', 'tuition_course'],
  timetable: ['timetable_class'],
  exams: ['exam'],
  dashboardNotices: ['portal_notice'],
};

export const adapterErrorCodeSchema = z.enum([
  'LOGIN_REQUIRED',
  'PORTAL_UNAVAILABLE',
  'ADAPTER_NEEDS_UPDATE',
  'NETWORK_ERROR',
]);

export type AdapterErrorCodeValue = z.infer<typeof adapterErrorCodeSchema>;

export const MAX_ENTITIES_PER_SOURCE = 5000;

export const sourceSnapshotSchema = z.discriminatedUnion('status', [
  z.strictObject({
    source: portalDataSourceSchema,
    status: z.literal('ok'),
    entities: z.array(normalizedEntitySchema).max(MAX_ENTITIES_PER_SOURCE),
  }),
  z.strictObject({
    source: portalDataSourceSchema,
    status: z.literal('error'),
    errorCode: adapterErrorCodeSchema,
    /** Page and field names only (e.g. "grades: table columns changed"), never values. */
    errorDetail: z
      .string()
      .max(200)
      .regex(/^[\w .,:;()/#-]*$/, 'Unexpected characters in error detail'),
  }),
]);

export type SourceSnapshot = z.infer<typeof sourceSnapshotSchema>;

/** Body of `POST /sync-runs` (device token). `syncRunId` makes retries idempotent. */
export const snapshotRequestSchema = z
  .strictObject({
    connectionId: z.uuid(),
    syncRunId: z.uuid(),
    collectedAt: z.iso.datetime(),
    sources: z.array(sourceSnapshotSchema).min(1).max(PORTAL_DATA_SOURCES.length),
  })
  .superRefine((snapshot, context) => {
    const seen = new Set<string>();
    snapshot.sources.forEach((entry, index) => {
      if (seen.has(entry.source)) {
        context.addIssue({
          code: 'custom',
          path: ['sources', index, 'source'],
          message: 'Duplicate source',
        });
      }
      seen.add(entry.source);
      if (entry.status !== 'ok') {
        return;
      }
      const allowed = SOURCE_ENTITY_TYPES[entry.source];
      const keys = new Set<string>();
      entry.entities.forEach((entity, entityIndex) => {
        const path = ['sources', index, 'entities', entityIndex];
        if (!allowed.includes(entity.entityType)) {
          context.addIssue({ code: 'custom', path, message: 'Entity type does not match source' });
        }
        const key = `${entity.entityType}\u0000${entity.externalKey}`;
        if (keys.has(key)) {
          context.addIssue({ code: 'custom', path, message: 'Duplicate entity' });
        }
        keys.add(key);
      });
    });
  });

export type SnapshotRequest = z.infer<typeof snapshotRequestSchema>;

export const syncRunStatusSchema = z.enum(['completed', 'partial', 'failed']);

export const sourceResultSchema = z.object({
  source: portalDataSourceSchema,
  status: z.enum(['ok', 'error']),
  errorCode: adapterErrorCodeSchema.optional(),
  errorDetail: z.string().optional(),
  entityCount: z.number().int().nonnegative(),
  /** True when this sync stored the first data for the source (no change events). */
  baseline: z.boolean().optional(),
});

export type SourceResult = z.infer<typeof sourceResultSchema>;

export const syncRunResultSchema = z.object({
  syncRunId: z.uuid(),
  status: syncRunStatusSchema,
  entityCount: z.number().int().nonnegative(),
  changeCount: z.number().int().nonnegative(),
  /** True when this `syncRunId` was already processed and the stored result is returned. */
  replayed: z.boolean(),
  sources: z.array(sourceResultSchema),
  connection: portalConnectionSchema,
});

export type SyncRunResult = z.infer<typeof syncRunResultSchema>;

export const fieldChangeSchema = z.object({
  field: z.string(),
  before: canonicalValueSchema.optional(),
  after: canonicalValueSchema.optional(),
});

export const changeEventSchema = z.object({
  id: z.uuid(),
  connectionId: z.uuid(),
  entityType: entityTypeSchema,
  externalKey: z.string(),
  kind: changeKindSchema,
  changedFields: z.array(fieldChangeSchema),
  /** Current (or, for REMOVED, last known) values, for display. */
  payload: canonicalPayloadSchema,
  createdAt: z.iso.datetime(),
});

export type ChangeEvent = z.infer<typeof changeEventSchema>;

export const changeListQuerySchema = z.strictObject({
  connectionId: z.uuid().optional(),
  entityType: entityTypeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  /** Opaque cursor from `nextCursor`. */
  before: z.string().max(100).optional(),
});

export type ChangeListQuery = z.infer<typeof changeListQuerySchema>;

export const changeListResponseSchema = z.object({
  changes: z.array(changeEventSchema),
  nextCursor: z.string().nullable(),
});

export type ChangeListResponse = z.infer<typeof changeListResponseSchema>;

export const storedEntitySchema = z.object({
  connectionId: z.uuid(),
  entityType: entityTypeSchema,
  externalKey: z.string(),
  payload: canonicalPayloadSchema,
  updatedAt: z.iso.datetime(),
});

export const entityListQuerySchema = z.strictObject({
  connectionId: z.uuid().optional(),
});

export type EntityListQuery = z.infer<typeof entityListQuerySchema>;

export const entityListResponseSchema = z.object({
  entities: z.array(storedEntitySchema),
});

export type EntityListResponse = z.infer<typeof entityListResponseSchema>;
