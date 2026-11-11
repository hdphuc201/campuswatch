import type { Job } from 'bullmq';
import { describe, expect, it } from 'vitest';
import { HEARTBEAT_JOB, SystemProcessor } from './system.processor.js';

const job = (name: string) => ({ name }) as Job;

describe('SystemProcessor', () => {
  const processor = new SystemProcessor();

  it('acknowledges heartbeat jobs', async () => {
    const result = await processor.process(job(HEARTBEAT_JOB));

    expect(Number.isNaN(Date.parse(result.processedAt))).toBe(false);
  });

  it('fails unknown jobs instead of silently dropping them', async () => {
    await expect(processor.process(job('unknown'))).rejects.toThrow(/Unsupported job "unknown"/);
  });
});
