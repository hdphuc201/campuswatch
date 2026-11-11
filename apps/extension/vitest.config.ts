import { defineConfig } from 'vitest/config';

// Extension logic is written against injected dependencies, so tests run in plain Node
// without a browser. Chrome-specific wiring lives in entrypoints/ and src/background/runtime.ts.
export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
