import { BullModule } from '@nestjs/bullmq';
import { type DynamicModule, Module } from '@nestjs/common';
import type { WorkerConfig } from './config.js';
import { SYSTEM_QUEUE, SystemProcessor } from './system/system.processor.js';

@Module({})
export class WorkerModule {
  static register(config: WorkerConfig): DynamicModule {
    return {
      module: WorkerModule,
      imports: [
        BullModule.forRoot({ connection: { ...config.redis } }),
        BullModule.registerQueue({ name: SYSTEM_QUEUE }),
      ],
      providers: [SystemProcessor],
    };
  }
}
