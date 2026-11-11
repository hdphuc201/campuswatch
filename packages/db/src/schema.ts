// Database schema. Every user-owned table references users(id) with ON DELETE CASCADE,
// and every query on it is scoped by user_id (implementation plan, section 9).
// Keep this file free of relative and workspace imports: drizzle-kit loads it directly.
import { sql } from 'drizzle-orm';
import {
  boolean,
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
export const NOTIFICATION_CHANNELS = ['chrome', 'telegram'] as const;
export const NOTIFICATION_CATEGORIES = [
  'grades',
  'tuition',
  'timetable',
  'exams',
  'notices',
] as const;
export const DELIVERY_STATUSES = ['pending', 'sending', 'sent', 'failed', 'skipped'] as const;

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

/** Per-user notification preferences (validated `NotificationPreferences` JSON). */
export const notificationPreferences = pgTable('notification_preferences', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One row per change event and channel. Chrome rows are claimed by a device and acknowledged;
 * Telegram rows are claimed and sent by the worker.
 */
export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    changeEventId: uuid('change_event_id')
      .notNull()
      .references(() => changeEvents.id, { onDelete: 'cascade' }),
    channel: text('channel', { enum: NOTIFICATION_CHANNELS }).notNull(),
    category: text('category', { enum: NOTIFICATION_CATEGORIES }).notNull(),
    urgent: boolean('urgent').notNull(),
    status: text('status', { enum: DELIVERY_STATUSES }).notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    deliverAfter: timestamp('deliver_after', { withTimezone: true }).notNull(),
    claimedUntil: timestamp('claimed_until', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    /** Error category only (e.g. "telegram_403"); never message content. */
    lastErrorCode: text('last_error_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('notification_deliveries_event_channel_unique').on(table.changeEventId, table.channel),
    index('notification_deliveries_due_idx').on(table.channel, table.status, table.deliverAfter),
    index('notification_deliveries_user_idx').on(table.userId, table.createdAt),
    check(
      'notification_deliveries_status_valid',
      sql`${table.status} in (${sqlList(DELIVERY_STATUSES)})`,
    ),
    check(
      'notification_deliveries_channel_valid',
      sql`${table.channel} in (${sqlList(NOTIFICATION_CHANNELS)})`,
    ),
  ],
);

/** A user's linked Telegram chat. The chat id is encrypted; the hash allows lookups. */
export const telegramLinks = pgTable(
  'telegram_links',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    chatIdEncrypted: text('chat_id_encrypted').notNull(),
    chatIdHash: text('chat_id_hash').notNull(),
    linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('telegram_links_chat_id_hash_idx').on(table.chatIdHash)],
);

/** One-time Telegram link codes (stored hashed, 10-minute TTL). */
export const telegramLinkNonces = pgTable(
  'telegram_link_nonces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    nonceHash: text('nonce_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [index('telegram_link_nonces_user_idx').on(table.userId)],
);
