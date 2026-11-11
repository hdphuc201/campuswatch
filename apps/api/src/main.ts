import { JsonLogger } from '@campuswatch/observability';
import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { loadApiConfig } from './config.js';
import { configureHttp, createHttpAdapter } from './http.js';

async function bootstrap(bootLogger: JsonLogger): Promise<void> {
  const config = loadApiConfig();
  const logger = new JsonLogger('campuswatch-api', config.logLevel);
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(config),
    createHttpAdapter({ trustProxyHops: config.trustProxyHops }),
    { logger },
  );
  configureHttp(app, { logger, production: config.nodeEnv === 'production' });
  app.enableShutdownHooks();
  if (config.auth.secretIsEphemeral) {
    bootLogger.warn(
      'AUTH_SECRET is not set; using a random secret. Tokens stop working on restart.',
    );
  }
  if (!config.redisUrl) {
    bootLogger.warn('REDIS_URL is not set; rate limits are per process (development only).');
  }
  await app.listen(config.port, config.host);
  bootLogger.log(`API listening on http://${config.host}:${config.port}`, 'Bootstrap');
}

const bootLogger = new JsonLogger('campuswatch-api');
bootstrap(bootLogger).catch((error: unknown) => {
  bootLogger.error(error instanceof Error ? error.message : 'Unknown startup error', 'Bootstrap');
  process.exitCode = 1;
});
