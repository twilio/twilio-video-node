import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import * as source from '../lib/index.js';

const require = createRequire(import.meta.url);

/**
 * The other suites exercise `lib/`, so a bundling fault could ship broken
 * artifacts while every test stayed green. These check the published entry
 * points directly: both must load, and both must expose the same public
 * surface as the source.
 *
 * Requires `npm run build:ts` to have produced `dist/`.
 */
describe('published bundle', () => {
  it('the ESM entry point loads and matches the source surface', async () => {
    const esm = await import('../dist/index.mjs');

    const sourceKeys = Object.keys(source).sort();
    const esmKeys = Object.keys(esm)
      .filter(k => k !== 'default')
      .sort();

    expect(esmKeys).toEqual(sourceKeys);
  });

  it('the CJS entry point loads and matches the source surface', () => {
    const cjs = require('../dist/index.cjs');

    const sourceKeys = Object.keys(source).sort();
    const cjsKeys = Object.keys(cjs)
      .filter(k => k !== 'default' && k !== '__esModule')
      .sort();

    expect(cjsKeys).toEqual(sourceKeys);
  });

  it('exports the same values through both entry points', async () => {
    const esm = await import('../dist/index.mjs');
    const cjs = require('../dist/index.cjs');

    // Spot-check a value, a class and a function rather than every export:
    // the key comparison above already covers presence.
    expect(cjs.MAX_QUEUE_CEILING).toBe(esm.MAX_QUEUE_CEILING);
    expect(typeof cjs.connect).toBe('function');
    expect(typeof esm.connect).toBe('function');
    expect(new cjs.RoomNotFoundError().code).toBe(new esm.RoomNotFoundError().code);
  });

  it('carries the runtime values consumers match on', async () => {
    const esm = await import('../dist/index.mjs');
    expect(esm.ErrorCode.MEDIA_NO_SUPPORTED_CODEC).toBe(53404);
    expect(esm.SDK_LOCAL_CODE).toBe(0);
    expect(esm.MAX_QUEUE_CEILING).toBe(1024);
  });
});
