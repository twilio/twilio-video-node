import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['lib/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  outDir: 'dist',
  external: [/\.node$/],
  platform: 'node',
  target: 'node24',
});
