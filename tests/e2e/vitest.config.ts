import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Needs PostgreSQL (`pnpm infra:up` or TEST_DATABASE_URL). SWC emits Nest decorator metadata
// for the API and worker sources the test imports.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.e2e.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
