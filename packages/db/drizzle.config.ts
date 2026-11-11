import { defineConfig } from 'drizzle-kit';

// Used only by `pnpm db:generate` to write SQL migrations; it never connects to a database.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './drizzle',
  strict: true,
});
