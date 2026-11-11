import { runMigrations } from './migrate.js';

/** Matches the defaults in infra/docker-compose.yml. Local development only. */
const LOCAL_DATABASE_URL = 'postgresql://campuswatch:campuswatch_local@127.0.0.1:5432/campuswatch';

const url = process.env.DATABASE_URL || LOCAL_DATABASE_URL;
if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) {
  process.stderr.write('DATABASE_URL is required in production\n');
  process.exit(1);
}

try {
  await runMigrations(url);
  process.stdout.write('Database migrations applied\n');
} catch (error: unknown) {
  // Driver messages never include the password; the URL itself is not printed.
  process.stderr.write(
    `Migration failed: ${error instanceof Error ? error.message : 'unknown error'}\n`,
  );
  process.exitCode = 1;
}
