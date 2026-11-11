import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { enabledLogLevels, loadApiConfig } from './config.js';

async function bootstrap(): Promise<void> {
  const config = loadApiConfig();
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    logger: enabledLogLevels(config.logLevel),
  });
  app.enableShutdownHooks();
  await app.listen(config.port, config.host);
  Logger.log(`API listening on http://${config.host}:${config.port}`, 'Bootstrap');
}

bootstrap().catch((error: unknown) => {
  Logger.error(error instanceof Error ? error.message : 'Unknown startup error', 'Bootstrap');
  process.exitCode = 1;
});
