import { defineConfig } from 'vitest/config';

/** The axe-core delegation suite, which needs a DOM and a generous timeout. */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/delegated.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
