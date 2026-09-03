import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Loads the published entry points in a fresh Node process, the way a consumer
 * would.
 *
 * The other suites import the SDK inside vitest, which transforms modules and
 * resolves them its own way. That hides packaging faults: a broken `exports`
 * map, a CJS build that cannot be `require`d, or an addon path that only
 * resolves under the test runner. A child process with no loader hooks is the
 * only way to catch those.
 *
 * Requires `npm run build:ts` and a built addon.
 */
function runNode(args: string[]): string {
  return execFileSync(process.execPath, args, {
    cwd: ROOT,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30_000,
  }).trim();
}

describe('module loading in a clean process', () => {
  it('loads through require() and exposes the public API', () => {
    const out = runNode([
      '-e',
      `const sdk = require('./dist/index.cjs');
       if (typeof sdk.connect !== 'function') throw new Error('connect missing');
       if (typeof sdk.createLocalVideoTrack !== 'function') throw new Error('factory missing');
       console.log('cjs-ok');`,
    ]);
    expect(out).toBe('cjs-ok');
  });

  it('loads through import() and exposes the public API', () => {
    const out = runNode([
      '--input-type=module',
      '-e',
      `const sdk = await import('./dist/index.mjs');
       if (typeof sdk.connect !== 'function') throw new Error('connect missing');
       if (typeof sdk.RemoteVideoTrack !== 'function') throw new Error('RemoteVideoTrack missing');
       console.log('esm-ok');`,
    ]);
    expect(out).toBe('esm-ok');
  });

  it('resolves the package by its exports map, not just by file path', () => {
    // Catches an exports map that points at files which do not exist, which a
    // direct dist/ import would not notice.
    const out = runNode([
      '--input-type=module',
      '-e',
      `const { createRequire } = await import('node:module');
       const require = createRequire(process.cwd() + '/');
       const pkg = require('./package.json');
       const entries = [pkg.exports['.'].import.default, pkg.exports['.'].require.default,
                        pkg.exports['.'].import.types, pkg.exports['.'].require.types];
       const fs = await import('node:fs');
       for (const e of entries) {
         if (!fs.existsSync(e)) throw new Error('missing entry: ' + e);
       }
       console.log('exports-ok');`,
    ]);
    expect(out).toBe('exports-ok');
  });

  it('reports the native engine version, proving the addon actually loaded', () => {
    const out = runNode([
      '-e',
      `const sdk = require('./dist/index.cjs');
       const v = sdk.getVersion();
       if (typeof v !== 'string' || v.length === 0) throw new Error('no version');
       console.log('version-ok');`,
    ]);
    expect(out).toBe('version-ok');
  });

  it('fails with a typed, actionable error when the addon is missing', () => {
    // Point the loader at a directory with no prebuilds and no build output, so
    // the failure path runs. It must name the platform and say what to do -
    // never segfault or throw something opaque.
    const out = runNode([
      '--input-type=module',
      '-e',
      `const fs = await import('node:fs');
       const os = await import('node:os');
       const path = await import('node:path');
       const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-noaddon-'));
       // A package.json is required: the loader reads the version from it.
       fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ version: '0.0.0-test' }));
       fs.mkdirSync(path.join(tmp, 'dist'));
       fs.copyFileSync('dist/index.mjs', path.join(tmp, 'dist', 'index.mjs'));
       try {
         await import(path.join(tmp, 'dist', 'index.mjs'));
         throw new Error('expected a load failure');
       } catch (err) {
         const msg = String(err && err.message);
         // Assert the properties that matter, not the exact prose: it must name
         // the platform and give a command to run.
         if (!msg.includes(process.platform + '-' + process.arch)) throw new Error('does not name the platform: ' + msg);
         if (!/npm run (build|fetch-deps)/.test(msg)) throw new Error('error is not actionable: ' + msg);
         console.log('missing-addon-ok');
       }`,
    ]);
    expect(out).toBe('missing-addon-ok');
  });

  it('rejects an unsupported platform by name instead of advising a build that cannot work', () => {
    // process.arch is a plain value property, so it can be redefined before the
    // module under test reads it. Apple Silicon is the real-world case: npm
    // refuses to install under arm64 because package.json declares cpu x64.
    const out = runNode([
      '--input-type=module',
      '-e',
      `Object.defineProperty(process, 'arch', { value: 'arm64', configurable: true });
       try {
         await import('./dist/index.mjs');
         throw new Error('expected an unsupported-platform failure');
       } catch (err) {
         const msg = String(err && err.message);
         if (!/darwin-arm64|linux-arm64/.test(msg)) throw new Error('does not name the platform: ' + msg);
         if (!/not a supported platform/.test(msg)) throw new Error('wrong error: ' + msg);
         if (/npm run build/.test(msg)) throw new Error('advises a build that cannot succeed: ' + msg);
         console.log('unsupported-platform-ok');
       }`,
    ]);
    expect(out).toBe('unsupported-platform-ok');
  });
});
