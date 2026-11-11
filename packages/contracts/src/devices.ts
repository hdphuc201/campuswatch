import { z } from 'zod';

export const registerDeviceRequestSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  extensionVersion: z.string().regex(/^\d+\.\d+\.\d+$/, 'Expected a version like 1.2.3'),
});

export type RegisterDeviceRequest = z.infer<typeof registerDeviceRequestSchema>;

export const deviceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  extensionVersion: z.string(),
  createdAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime().nullable(),
});

export type Device = z.infer<typeof deviceSchema>;

/** The device token is returned once, at registration, and only its hash is stored. */
export const registerDeviceResponseSchema = z.object({
  device: deviceSchema,
  deviceToken: z.string().min(1),
});

export type RegisterDeviceResponse = z.infer<typeof registerDeviceResponseSchema>;

export const deviceListResponseSchema = z.object({
  devices: z.array(deviceSchema),
});

export type DeviceListResponse = z.infer<typeof deviceListResponseSchema>;
