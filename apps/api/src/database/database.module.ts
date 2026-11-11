import {
  type DynamicModule,
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

export const PG_POOL = Symbol('PG_POOL');
export const DATABASE = Symbol('DATABASE');

export type Database = NodePgDatabase;

export interface DatabaseOptions {
  readonly url: string;
  readonly poolMax: number;
}

@Injectable()
class PoolLifecycle implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

@Global()
@Module({})
export class DatabaseModule {
  static register(options: DatabaseOptions): DynamicModule {
    return {
      module: DatabaseModule,
      providers: [
        {
          provide: PG_POOL,
          useFactory: () => {
            const pool = new pg.Pool({ connectionString: options.url, max: options.poolMax });
            // An idle client can fail (e.g. database restart); log instead of crashing.
            pool.on('error', (error) => Logger.error(error.message, 'DatabasePool'));
            return pool;
          },
        },
        {
          provide: DATABASE,
          inject: [PG_POOL],
          useFactory: (pool: pg.Pool): Database => drizzle(pool),
        },
        PoolLifecycle,
      ],
      exports: [PG_POOL, DATABASE],
    };
  }
}
