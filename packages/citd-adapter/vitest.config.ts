import { defineConfig } from 'vitest/config';

// Parsers run on real DOM documents in the browser; happy-dom provides one in tests.
export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
  },
});
