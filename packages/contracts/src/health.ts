import { z } from 'zod';

/** Response body of `GET /health` (liveness: the process is up). */
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.string().min(1),
  timestamp: z.iso.datetime(),
  uptimeSeconds: z.number().nonnegative(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

/** Response body of `GET /health/ready` (readiness: dependencies are reachable). */
export const readinessResponseSchema = z.object({
  status: z.enum(['ok', 'unavailable']),
  checks: z.object({
    database: z.enum(['ok', 'error']),
  }),
});

export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
