import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from './health.js';

describe('healthResponseSchema', () => {
  it('accepts a valid health response', () => {
    const result = healthResponseSchema.safeParse({
      status: 'ok',
      service: 'campuswatch-api',
      timestamp: '2026-11-11T00:00:00.000Z',
      uptimeSeconds: 1.5,
    });

    expect(result.success).toBe(true);
  });

  it('rejects an unknown status and a non-ISO timestamp', () => {
    const result = healthResponseSchema.safeParse({
      status: 'degraded',
      service: 'campuswatch-api',
      timestamp: 'yesterday',
      uptimeSeconds: 1,
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path[0])).toEqual(['status', 'timestamp']);
  });
});
