import { JsonLogger } from '@campuswatch/observability';
import { NestFactory } from '@nestjs/core';
import { loadWorkerConfig } from './config.js';
import { WorkerModule } from './worker.module.js';

async function bootstrap(bootLogger: JsonLogger): Promise<void> {
  const config = loadWorkerConfig();
  const app = await NestFactory.createApplicationContext(WorkerModule.register(config), {
    logger: new JsonLogger('campuswatch-worker', config.logLevel),
  });
  // Closes BullMQ workers, Redis, and database connections on SIGINT/SIGTERM before exiting.
  app.enableShutdownHooks();
  bootLogger.log(`Worker ready (Redis ${config.redis.host}:${config.redis.port})`, 'Bootstrap');
}

const bootLogger = new JsonLogger('campuswatch-worker');
bootstrap(bootLogger).catch((error: unknown) => {
  bootLogger.error(error instanceof Error ? error.message : 'Unknown startup error', 'Bootstrap');
  process.exitCode = 1;
});
