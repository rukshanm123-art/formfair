import { defineConfig } from 'vitest/config';

/**
 * The default run covers the rule catalogue and the reports. The delegated suite boots
 * jsdom and axe-core, which is an order of magnitude slower than everything else, so it
 * is excluded here and run by `npm run test:delegated`. CI runs both.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/delegated.test.ts'],
    coverage: { reporter: ['text', 'lcov'], include: ['src/**/*.ts'] },
  },
});
