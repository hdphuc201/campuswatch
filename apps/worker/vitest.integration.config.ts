import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Integration tests need PostgreSQL (`pnpm infra:up` or TEST_DATABASE_URL).
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.int.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
