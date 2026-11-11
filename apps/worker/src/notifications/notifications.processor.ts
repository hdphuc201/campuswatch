import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import type { WorkerConfig } from '../config.js';
import { WORKER_CONFIG } from '../tokens.js';
import type { DispatchResult, TelegramDispatcher } from './telegram-dispatcher.js';

export const NOTIFICATIONS_QUEUE = 'notifications';
export const DISPATCH_TELEGRAM_JOB = 'dispatch-telegram';
export const TELEGRAM_DISPATCHER = Symbol('TELEGRAM_DISPATCHER');

@Processor(NOTIFICATIONS_QUEUE)
export class NotificationsProcessor extends WorkerHost {
  constructor(@Inject(TELEGRAM_DISPATCHER) private readonly dispatcher: TelegramDispatcher | null) {
    super();
  }

  override async process(job: Job): Promise<DispatchResult | null> {
    if (job.name !== DISPATCH_TELEGRAM_JOB) {
      throw new Error(`Unsupported job "${job.name}" on queue "${NOTIFICATIONS_QUEUE}"`);
    }
    return this.dispatcher ? this.dispatcher.dispatchDue() : null;
  }
}

/** Registers the repeating Telegram dispatch when a bot is configured. */
@Injectable()
export class NotificationsScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(NotificationsScheduler.name);

  constructor(
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue,
    @Inject(WORKER_CONFIG) private readonly config: WorkerConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.telegram) {
      await this.queue.removeJobScheduler(DISPATCH_TELEGRAM_JOB);
      this.logger.warn('Telegram delivery disabled: TELEGRAM_BOT_TOKEN is not set');
      return;
    }
    await this.queue.upsertJobScheduler(
      DISPATCH_TELEGRAM_JOB,
      { every: this.config.telegramDispatchIntervalSeconds * 1000 },
      { name: DISPATCH_TELEGRAM_JOB, opts: { removeOnComplete: 100, removeOnFail: 100 } },
    );
    this.logger.log(
      `Telegram dispatch every ${this.config.telegramDispatchIntervalSeconds} seconds`,
    );
  }
}
