// Database schema. Every user-owned table references users(id) with ON DELETE CASCADE,
// and every query on it is scoped by user_id (implementation plan, section 9).
// Keep this file free of relative and workspace imports: drizzle-kit loads it directly.
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

/** Mirrors `connectionHealthStateSchema` in @campuswatch/contracts. */
export const CONNECTION_STATUSES = [
  'CONNECTED',
  'SYNCING',
  'PAUSED',
  'LOGIN_REQUIRED',
  'PORTAL_UNAVAILABLE',
  'ADAPTER_NEEDS_UPDATE',
  'NETWORK_ERROR',
  'DISCONNECTED',
] as const;

/** Mirrors `adapterKeySchema` in @campuswatch/contracts. */
export const ADAPTER_KEYS = ['citd'] as const;

/** Mirrors `entityTypeSchema` in @campuswatch/contracts. */
export const ENTITY_TYPES = [
  'grade_course',
  'grade_summary',
  'tuition_term',
  'tuition_course',
  'timetable_class',
  'exam',
  'portal_notice',
] as const;

export const CHANGE_KINDS = ['ADDED', 'UPDATED', 'REMOVED'] as const;
export const SYNC_RUN_STATUSES = ['completed', 'partial', 'failed'] as const;

/** Canonical values only (see `canonicalValueSchema`): never HTML, cookies, or tokens. */
export type CanonicalJson = Record<string, string | number | boolean | null>;

export interface FieldChangeJson {
  field: string;
  before?: string | number | boolean | null;
  after?: string | number | boolean | null;
}

export interface SourceResultJson {
  source: string;
  status: 'ok' | 'error';
  errorCode?: string;
  errorDetail?: string;
  entityCount: number;
  baseline?: boolean;
}

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const sqlList = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(', '));

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Stored trimmed and lowercased. */
    email: text('email').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    status: text('status', { enum: ['active', 'disabled'] })
      .notNull()
      .default('active'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    check('users_email_normalized', sql`${table.email} = lower(btrim(${table.email}))`),
    check('users_status_valid', sql`${table.status} in ('active', 'disabled')`),
  ],
);

/**
 * One row per refresh token. Rotation revokes the presented token and issues a new one
 * in the same family; presenting a revoked token revokes the whole family.
 */
export const authSessions = pgTable(
  'auth_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id').notNull(),
    /** SHA-256 of the refresh token; the token itself is never stored. */
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    index('auth_sessions_user_id_idx').on(table.userId),
    index('auth_sessions_family_id_idx').on(table.familyId),
  ],
);

export const devices = pgTable(
  'devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    extensionVersion: text('extension_version').notNull(),
    /** SHA-256 of the device token; the token itself is never stored. */
    tokenHash: text('token_hash').notNull().unique(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [index('devices_user_id_idx').on(table.userId)],
);

/** Connection state only. Portal credentials, cookies, and tokens are never stored. */
export const portalConnections = pgTable(
  'portal_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    adapterKey: text('adapter_key', { enum: ADAPTER_KEYS }).notNull(),
    status: text('status', { enum: CONNECTION_STATUSES }).notNull(),
    consentVersion: text('consent_version').notNull(),
    lastProbedAt: timestamp('last_probed_at', { withTimezone: true }),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('portal_connections_user_adapter_unique').on(table.userId, table.adapterKey),
    check(
      'portal_connections_adapter_valid',
      sql`${table.adapterKey} in (${sqlList(ADAPTER_KEYS)})`,
    ),
    check(
      'portal_connections_status_valid',
      sql`${table.status} in (${sqlList(CONNECTION_STATUSES)})`,
    ),
  ],
);

/** Consent history; kept when a connection is deleted so grants and revocations stay auditable. */
export const consentAudits = pgTable(
  'consent_audits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    adapterKey: text('adapter_key').notNull(),
    policyVersion: text('policy_version').notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [index('consent_audits_user_id_idx').on(table.userId)],
);

/** One snapshot upload. `client_run_id` (the extension's syncRunId) makes retries idempotent. */
export const syncRuns = pgTable(
  'sync_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => portalConnections.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id').references(() => devices.id, { onDelete: 'set null' }),
    clientRunId: uuid('client_run_id').notNull(),
    status: text('status', { enum: SYNC_RUN_STATUSES }).notNull(),
    /** Per-source outcome: codes, counts, and page/field names only. */
    sourceResults: jsonb('source_results').$type<SourceResultJson[]>().notNull(),
    entityCount: integer('entity_count').notNull(),
    changeCount: integer('change_count').notNull(),
    collectedAt: timestamp('collected_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('sync_runs_connection_client_run_unique').on(table.connectionId, table.clientRunId),
    index('sync_runs_user_id_idx').on(table.userId),
    check('sync_runs_status_valid', sql`${table.status} in (${sqlList(SYNC_RUN_STATUSES)})`),
  ],
);

/** Latest canonical state of every Portal entity, per connection. */
export const entities = pgTable(
  'entities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => portalConnections.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    entityType: text('entity_type', { enum: ENTITY_TYPES }).notNull(),
    externalKey: text('external_key').notNull(),
    payload: jsonb('payload').$type<CanonicalJson>().notNull(),
    fingerprint: text('fingerprint').notNull(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('entities_connection_type_key_unique').on(
      table.connectionId,
      table.entityType,
      table.externalKey,
    ),
    index('entities_user_id_idx').on(table.userId),
    check('entities_type_valid', sql`${table.entityType} in (${sqlList(ENTITY_TYPES)})`),
  ],
);

/** History of ADDED / UPDATED / REMOVED changes with field-level diffs. */
export const changeEvents = pgTable(
  'change_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => portalConnections.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    syncRunId: uuid('sync_run_id')
      .notNull()
      .references(() => syncRuns.id, { onDelete: 'cascade' }),
    entityType: text('entity_type', { enum: ENTITY_TYPES }).notNull(),
    externalKey: text('external_key').notNull(),
    kind: text('kind', { enum: CHANGE_KINDS }).notNull(),
    changedFields: jsonb('changed_fields').$type<FieldChangeJson[]>().notNull(),
    /** Values after the change (before, for REMOVED), for display and notifications. */
    payload: jsonb('payload').$type<CanonicalJson>().notNull(),
    fingerprint: text('fingerprint').notNull(),
    previousFingerprint: text('previous_fingerprint'),
    /** SHA-256 of connection + entity + kind + fingerprints: one event per real change. */
    idempotencyKey: text('idempotency_key').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('change_events_user_created_idx').on(table.userId, table.createdAt),
    index('change_events_connection_created_idx').on(table.connectionId, table.createdAt),
    check('change_events_kind_valid', sql`${table.kind} in (${sqlList(CHANGE_KINDS)})`),
  ],
);
