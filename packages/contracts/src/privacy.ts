import { z } from 'zod';
import { userProfileSchema } from './auth.js';
import { portalConnectionSchema } from './connection.js';
import { deviceSchema } from './devices.js';
import { deliverySchema, notificationPreferencesSchema } from './notifications.js';
import { changeEventSchema, storedEntitySchema } from './sync.js';

/** Sensitive operations ask for the password again (implementation plan, section 8). */
export const reauthenticationRequestSchema = z.strictObject({
  password: z.string().min(1).max(128),
});

export type ReauthenticationRequest = z.infer<typeof reauthenticationRequestSchema>;

/** `POST /auth/register` always answers 202 with this body, whether or not the email exists. */
export const registerAcceptedResponseSchema = z.object({
  status: z.literal('accepted'),
});

export type RegisterAcceptedResponse = z.infer<typeof registerAcceptedResponseSchema>;

export const consentRecordSchema = z.object({
  adapterKey: z.string(),
  policyVersion: z.string(),
  grantedAt: z.iso.datetime(),
  revokedAt: z.iso.datetime().nullable(),
});

export const consentListResponseSchema = z.object({ consents: z.array(consentRecordSchema) });

export type ConsentListResponse = z.infer<typeof consentListResponseSchema>;

/** Everything CampusWatch stores about a user, in portable JSON. Contains no secrets. */
export const dataExportSchema = z.object({
  exportedAt: z.iso.datetime(),
  profile: userProfileSchema,
  devices: z.array(deviceSchema),
  connections: z.array(portalConnectionSchema),
  consents: z.array(consentRecordSchema),
  entities: z.array(storedEntitySchema),
  changes: z.array(changeEventSchema),
  notificationPreferences: notificationPreferencesSchema,
  deliveries: z.array(deliverySchema),
  telegram: z.object({ linked: z.boolean(), linkedAt: z.iso.datetime().nullable() }),
});

export type DataExport = z.infer<typeof dataExportSchema>;

export const deletionResultSchema = z.object({
  status: z.literal('deleted'),
  scope: z.enum(['data', 'account']),
});

export type DeletionResult = z.infer<typeof deletionResultSchema>;
