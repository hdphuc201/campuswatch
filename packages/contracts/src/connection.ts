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
