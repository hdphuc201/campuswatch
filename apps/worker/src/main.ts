import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { enabledLogLevels, loadWorkerConfig } from './config.js';
import { WorkerModule } from './worker.module.js';

async function bootstrap(): Promise<void> {
  const config = loadWorkerConfig();
  const app = await NestFactory.createApplicationContext(WorkerModule.register(config), {
    logger: enabledLogLevels(config.logLevel),
  });
  // Closes BullMQ workers and Redis connections on SIGINT/SIGTERM before exiting.
  app.enableShutdownHooks();
  Logger.log(`Worker ready (Redis ${config.redis.host}:${config.redis.port})`, 'Bootstrap');
}

bootstrap().catch((error: unknown) => {
  Logger.error(error instanceof Error ? error.message : 'Unknown startup error', 'Bootstrap');
  process.exitCode = 1;
});
