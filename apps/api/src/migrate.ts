import { Logger } from '@nestjs/common';
import { loadApiConfig } from './config.js';
import { runMigrations } from './database/migrate.js';

try {
  await runMigrations(loadApiConfig().database.url);
  Logger.log('Database migrations applied', 'Migrate');
} catch (error: unknown) {
  Logger.error(error instanceof Error ? error.message : 'Unknown migration error', 'Migrate');
  process.exitCode = 1;
}
