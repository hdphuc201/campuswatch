import { z } from 'zod';

/** Connection health states shown to the user (implementation plan, section 11). */
export const connectionHealthStateSchema = z.enum([
  'CONNECTED',
  'SYNCING',
  'PAUSED',
  'LOGIN_REQUIRED',
  'PORTAL_UNAVAILABLE',
  'ADAPTER_NEEDS_UPDATE',
  'NETWORK_ERROR',
  'DISCONNECTED',
]);

export type ConnectionHealthState = z.infer<typeof connectionHealthStateSchema>;

/** Portal adapters the Backend accepts connections for. */
export const adapterKeySchema = z.enum(['citd']);

export type AdapterKey = z.infer<typeof adapterKeySchema>;

export const createPortalConnectionRequestSchema = z.strictObject({
  adapterKey: adapterKeySchema,
  /** Version of the consent text the student accepted. */
  consentVersion: z.string().trim().min(1).max(32),
});

export type CreatePortalConnectionRequest = z.infer<typeof createPortalConnectionRequestSchema>;

export const portalConnectionSchema = z.object({
  id: z.uuid(),
  adapterKey: adapterKeySchema,
  status: connectionHealthStateSchema,
  consentVersion: z.string(),
  lastProbedAt: z.iso.datetime().nullable(),
  lastSyncAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

export type PortalConnection = z.infer<typeof portalConnectionSchema>;

export const portalConnectionListResponseSchema = z.object({
  connections: z.array(portalConnectionSchema),
});

export type PortalConnectionListResponse = z.infer<typeof portalConnectionListResponseSchema>;

/** Session probe outcome reported by the extension for its own logged-in Portal tab. */
export const probeReportRequestSchema = z.strictObject({
  result: z.enum(['authenticated', 'login_required', 'unavailable']),
});

export type ProbeReportRequest = z.infer<typeof probeReportRequestSchema>;
