// Database schema. Every user-owned table references users(id) with ON DELETE CASCADE,
// and every query on it is scoped by user_id (implementation plan, section 9).
// Keep this file free of relative and workspace imports: drizzle-kit loads it directly.
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

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
