import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { runMigrations } from '@campuswatch/db';

/** Admin connection used to create and drop throwaway databases (local default: infra compose). */
const ADMIN_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://campuswatch:campuswatch_local@127.0.0.1:5432/postgres';

export interface TestDatabase {
  readonly url: string;
  drop(): Promise<void>;
}

async function admin<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: ADMIN_URL });
  try {
    await client.connect();
  } catch (error) {
    throw new Error(
      'Integration tests need PostgreSQL. Run `pnpm infra:up` or set TEST_DATABASE_URL.',
      { cause: error },
    );
  }
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

/** Creates an empty, fully migrated database used by one test file only. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const name = `campuswatch_test_${randomBytes(6).toString('hex')}`;
  await admin((client) => client.query(`CREATE DATABASE "${name}"`));
  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  await runMigrations(url.toString());
  return {
    url: url.toString(),
    drop: async () => {
      await admin((client) => client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`));
    },
  };
}
