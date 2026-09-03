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
      // A deleted or silently-skipped test file shows up here as a coverage
      // drop. Nothing else catches that: vitest exits 0 both when a named test
      // file is missing and when one is simply removed.
      thresholds: {
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90,
      },
    },
  },
});
