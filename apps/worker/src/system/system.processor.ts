import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';

export const SYSTEM_QUEUE = 'system';
export const HEARTBEAT_JOB = 'heartbeat';

export interface HeartbeatResult {
  readonly processedAt: string;
}

/**
 * Handles internal system jobs. `heartbeat` proves the queue round trip works;
 * notification and retention processors are added in later phases.
 */
@Processor(SYSTEM_QUEUE)
export class SystemProcessor extends WorkerHost {
  override process(job: Job): Promise<HeartbeatResult> {
    if (job.name !== HEARTBEAT_JOB) {
      return Promise.reject(new Error(`Unsupported job "${job.name}" on queue "${SYSTEM_QUEUE}"`));
    }
    return Promise.resolve({ processedAt: new Date().toISOString() });
  }
}
