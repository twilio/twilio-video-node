import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 60000,
    hookTimeout: 30000,
    typecheck: { enabled: false },
    coverage: {
      provider: 'v8',
      // Measure the TypeScript sources, not the bundle: `dist` is one
      // concatenated file, so per-module coverage there is not actionable.
      include: ['lib/**/*.ts'],
      exclude: ['lib/types.ts'],
      reporter: ['text', 'lcov'],
    },
  },
});
