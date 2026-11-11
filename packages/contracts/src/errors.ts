import { z } from 'zod';

/** Stable machine-readable error codes in every API error body (`{ statusCode, code, message }`). */
export const API_ERROR_CODES = [
  'bad_request',
  'validation_failed',
  'unauthorized',
  'reauthentication_failed',
  'forbidden',
  'not_found',
  'conflict',
  'connection_paused',
  'payload_too_large',
  'rate_limited',
  'telegram_unavailable',
  'service_unavailable',
  'internal_error',
] as const;

export const apiErrorCodeSchema = z.enum(API_ERROR_CODES);

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

export const apiErrorSchema = z.object({
  statusCode: z.number().int(),
  code: apiErrorCodeSchema,
  message: z.string(),
  /** Correlates the response with server logs; contains no user data. */
  requestId: z.string().optional(),
  issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});

export type ApiErrorBody = z.infer<typeof apiErrorSchema>;
