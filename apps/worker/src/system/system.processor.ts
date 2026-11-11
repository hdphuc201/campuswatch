import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import type { RetentionReport, RetentionService } from './retention.js';

export const SYSTEM_QUEUE = 'system';
export const HEARTBEAT_JOB = 'heartbeat';
export const RETENTION_JOB = 'retention';
export const RETENTION_SERVICE = Symbol('RETENTION_SERVICE');

export interface HeartbeatResult {
  readonly processedAt: string;
}

/** Internal system jobs: `heartbeat` (queue round trip) and daily `retention`. */
@Processor(SYSTEM_QUEUE)
export class SystemProcessor extends WorkerHost {
  private readonly logger = new Logger(SystemProcessor.name);

  constructor(@Inject(RETENTION_SERVICE) private readonly retention: RetentionService) {
    super();
  }

  override async process(job: Job): Promise<HeartbeatResult | RetentionReport> {
    if (job.name === HEARTBEAT_JOB) {
      return { processedAt: new Date().toISOString() };
    }
    if (job.name === RETENTION_JOB) {
      const report = await this.retention.run();
      this.logger.log(`Retention removed ${JSON.stringify(report)}`);
      return report;
    }
    throw new Error(`Unsupported job "${job.name}" on queue "${SYSTEM_QUEUE}"`);
  }
}

/** Schedules retention daily at 03:17 Vietnam time (low traffic). */
@Injectable()
export class SystemScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue(SYSTEM_QUEUE) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      RETENTION_JOB,
      { pattern: '17 3 * * *', tz: 'Asia/Ho_Chi_Minh' },
      { name: RETENTION_JOB, opts: { removeOnComplete: 30, removeOnFail: 30 } },
    );
  }
}
