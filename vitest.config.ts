import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 60000,
    hookTimeout: 30000,
    typecheck: { enabled: false },
    coverage: {
      provider: 'v8',
      include: ['dist/**/*.cjs', 'dist/**/*.mjs'],
      reporter: ['text', 'lcov'],
    },
  },
});
