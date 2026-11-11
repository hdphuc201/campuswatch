import { createChatIdCipher, createHttpTelegramClient } from '@campuswatch/notifications/server';
import { BullModule } from '@nestjs/bullmq';
import {
  type DynamicModule,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { WorkerConfig } from './config.js';
import {
  NOTIFICATIONS_QUEUE,
  NotificationsProcessor,
  NotificationsScheduler,
  TELEGRAM_DISPATCHER,
} from './notifications/notifications.processor.js';
import { TelegramDispatcher } from './notifications/telegram-dispatcher.js';
import { SYSTEM_QUEUE, SystemProcessor } from './system/system.processor.js';
import { DATABASE, PG_POOL, WORKER_CONFIG } from './tokens.js';

@Injectable()
class PoolLifecycle implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

@Module({})
export class WorkerModule {
  static register(config: WorkerConfig): DynamicModule {
    return {
      module: WorkerModule,
      imports: [
        BullModule.forRoot({ connection: { ...config.redis } }),
        BullModule.registerQueue({ name: SYSTEM_QUEUE }, { name: NOTIFICATIONS_QUEUE }),
      ],
      providers: [
        { provide: WORKER_CONFIG, useValue: config },
        {
          provide: PG_POOL,
          useFactory: () => {
            const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 5 });
            pool.on('error', (error) => Logger.error(error.message, 'DatabasePool'));
            return pool;
          },
        },
        {
          provide: DATABASE,
          inject: [PG_POOL],
          useFactory: (pool: pg.Pool): NodePgDatabase => drizzle(pool),
        },
        {
          provide: TELEGRAM_DISPATCHER,
          inject: [DATABASE],
          useFactory: (db: NodePgDatabase) =>
            config.telegram
              ? new TelegramDispatcher(
                  db,
                  createHttpTelegramClient(config.telegram.botToken),
                  createChatIdCipher(config.telegram.encryptionKey),
                )
              : null,
        },
        PoolLifecycle,
        SystemProcessor,
        NotificationsProcessor,
        NotificationsScheduler,
      ],
    };
  }
}
