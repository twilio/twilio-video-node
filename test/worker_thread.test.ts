import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ESM_URL = pathToFileURL(path.join(ROOT, 'dist', 'index.mjs')).href;
const CJS_PATH = path.join(ROOT, 'dist', 'index.cjs');

/**
 * Runs `script` as an ES module in a fresh process, since the addon loads once
 * per process. Requires `npm run build:ts` and a built addon.
 */
function runNode(script: string) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 30_000,
  });
}

// Resolves with the error the worker's import threw, or 'loaded'.
const WORKER_HELPER = `
  import { Worker } from 'node:worker_threads';
  function importInWorker(body) {
    const code = \`
      const { parentPort } = require('node:worker_threads');
      (async () => { \${body} })().then(
        () => parentPort.postMessage('loaded'),
        e => parentPort.postMessage({ name: e.name, code: e.code, message: e.message }),
      );\`;
    return new Promise((resolve, reject) => {
      // Don't inherit --input-type=module, so this code runs as CommonJS.
      const worker = new Worker(code, { eval: true, execArgv: [] });
      worker.once('message', resolve);
      worker.once('error', reject);
    });
  }
`;

// Both calls use the addon's constructors, which a worker's load would overwrite.
const USE_SDK_ON_MAIN = `
  sdk.createLocalDataTrack();
  const connectError = await sdk
    .connect('token', { videoEncodingMode: 'not-a-mode' })
    .then(() => 'connected', e => e.message);
`;

function expectWorkerRefused(result: ReturnType<typeof runNode>) {
  expect(result.status, `${result.signal ?? ''} ${result.stderr}`).toBe(0);
  const out = JSON.parse(result.stdout);
  expect(out.worker).toEqual({
    name: 'UnsupportedPlatformError',
    code: 0,
    message: expect.stringMatching(/only be loaded on the main thread/),
  });
  expect(out.connectError).toMatch(/Unknown videoEncodingMode: not-a-mode/);
}

describe('importing the SDK in a worker_thread', () => {
  it('throws in the worker and leaves the main thread working when main loaded first', () => {
    const result = runNode(`
      ${WORKER_HELPER}
      const sdk = await import('${ESM_URL}');
      sdk.createLocalDataTrack();
      const worker = await importInWorker("await import('${ESM_URL}')");
      ${USE_SDK_ON_MAIN}
      console.log(JSON.stringify({ worker, connectError }));
      process.exit(0);
    `);
    expectWorkerRefused(result);
  });

  it('throws from require() in a worker that loads before the main thread', () => {
    const result = runNode(`
      ${WORKER_HELPER}
      const worker = await importInWorker(${JSON.stringify(`require(${JSON.stringify(CJS_PATH)})`)});
      const sdk = await import('${ESM_URL}');
      ${USE_SDK_ON_MAIN}
      console.log(JSON.stringify({ worker, connectError }));
      process.exit(0);
    `);
    expectWorkerRefused(result);
  });
});
