import type { Job } from 'bullmq';
import { describe, expect, it } from 'vitest';
import type { RetentionService } from './retention.js';
import { HEARTBEAT_JOB, RETENTION_JOB, SystemProcessor } from './system.processor.js';

const job = (name: string) => ({ name }) as Job;
const report = {
  changeEvents: 1,
  deliveries: 2,
  syncRuns: 3,
  authSessions: 4,
  linkNonces: 5,
  revokedDevices: 6,
};
const retention = { run: () => Promise.resolve(report) } as unknown as RetentionService;

describe('SystemProcessor', () => {
  const processor = new SystemProcessor(retention);

  it('acknowledges heartbeat jobs', async () => {
    const result = await processor.process(job(HEARTBEAT_JOB));

    expect(Number.isNaN(Date.parse((result as { processedAt: string }).processedAt))).toBe(false);
  });

  it('runs retention', async () => {
    expect(await processor.process(job(RETENTION_JOB))).toEqual(report);
  });

  it('fails unknown jobs instead of silently dropping them', async () => {
    await expect(processor.process(job('unknown'))).rejects.toThrow(/Unsupported job "unknown"/);
  });
});
