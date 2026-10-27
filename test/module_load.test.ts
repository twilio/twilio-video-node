import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
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

  /**
   * Imports the built entry point as `platform`/`arch` from a copy of the
   * package that has no prebuilt and no local build, which is what a consumer
   * has: `files` excludes build/, so an installed package never carries one.
   * Returns `<error name>: <message>` for the load failure.
   *
   * process.platform and process.arch are plain value properties, so they can
   * be redefined before the module under test reads them. `glibc`, when given,
   * is what the process report claims the C library is, since the suite cannot
   * run on every distro.
   */
  function importWithoutAddonOn(platform: string, arch: string, glibc?: string): string {
    return runNode([
      '--input-type=module',
      '-e',
      `Object.defineProperty(process, 'platform', { value: '${platform}', configurable: true });
       Object.defineProperty(process, 'arch', { value: '${arch}', configurable: true });
       if ('${glibc ?? ''}') {
         process.report.getReport = () => ({ header: { glibcVersionRuntime: '${glibc}' } });
       }
       const fs = await import('node:fs');
       const os = await import('node:os');
       const path = await import('node:path');
       const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-platform-'));
       fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ version: '0.0.0-test' }));
       fs.mkdirSync(path.join(tmp, 'dist'));
       fs.copyFileSync('dist/index.mjs', path.join(tmp, 'dist', 'index.mjs'));
       try {
         await import(path.join(tmp, 'dist', 'index.mjs'));
         throw new Error('expected a load failure');
       } catch (err) {
         console.log(err.name + ': ' + err.message);
       }`,
    ]);
  }

  it.each([
    ['darwin', 'x64'],
    ['linux', 'arm64'],
  ])('rejects %s-%s by name instead of advising a build that cannot work', (platform, arch) => {
    // package.json lists os and cpu independently, so npm installs on these
    // combinations. The loader must refuse them by name, and must not send
    // the user to Rosetta or to a build that cannot succeed.
    const out = importWithoutAddonOn(platform, arch);
    expect(out).toMatch(/^UnsupportedPlatformError: /);
    expect(out).toContain(`${platform}-${arch} is not a supported platform`);
    expect(out).toContain('linux-x64 and darwin-arm64');
    expect(out).not.toMatch(/Rosetta|npm run build/);
  });

  it('treats darwin-arm64 as supported, so a missing addon is a build problem', () => {
    const out = importWithoutAddonOn('darwin', 'arm64');
    expect(out).toMatch(/^NativeBindingLoadError: /);
    expect(out).toContain('No prebuilt binary for darwin-arm64');
    expect(out).toMatch(/npm run (build|fetch-deps)/);
  });

  it('rejects a glibc older than 2.38 by version instead of failing later', () => {
    // The native library references glibc 2.38 symbols. On an older glibc the
    // addon loads and the process dies with a symbol lookup error the first
    // time that code runs, so refuse at import.
    const out = importWithoutAddonOn('linux', 'x64', '2.35');
    expect(out).toMatch(/^UnsupportedPlatformError: /);
    expect(out).toContain('glibc 2.35');
    expect(out).toContain('glibc 2.38 or later');
    expect(out).not.toMatch(/npm run build/);
  });

  it('accepts glibc 2.38, so a missing addon is a build problem', () => {
    const out = importWithoutAddonOn('linux', 'x64', '2.38');
    expect(out).toMatch(/^NativeBindingLoadError: /);
    expect(out).toContain('No prebuilt binary for linux-x64');
  });

  it('does not apply the glibc floor off Linux', () => {
    const out = importWithoutAddonOn('darwin', 'arm64', '2.35');
    expect(out).toMatch(/^NativeBindingLoadError: /);
  });

  it('loads a local build even on a platform the package does not list', () => {
    // A contributor who compiled the addon themselves must be able to load it.
    // The platform gate runs only after the prebuilt and local-build paths, so
    // an unlisted platform is not, on its own, a refusal to load.
    const out = runNode([
      '--input-type=module',
      '-e',
      `Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
       Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
       const fs = await import('node:fs');
       const os = await import('node:os');
       const path = await import('node:path');
       const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-localbuild-'));
       fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ version: '0.0.0-test' }));
       fs.mkdirSync(path.join(tmp, 'dist'));
       fs.copyFileSync('dist/index.mjs', path.join(tmp, 'dist', 'index.mjs'));
       fs.mkdirSync(path.join(tmp, 'build', 'Release'), { recursive: true });
       // Symlinked, not copied: the addon is tens of megabytes.
       fs.symlinkSync(
         path.resolve('build/Release/twilio_video_sdk_node.node'),
         path.join(tmp, 'build', 'Release', 'twilio_video_sdk_node.node'),
       );
       const sdk = await import(path.join(tmp, 'dist', 'index.mjs'));
       if (typeof sdk.getVersion() !== 'string') throw new Error('addon did not load');
       console.log('local-build-ok');`,
    ]);
    expect(out).toBe('local-build-ok');
  });

  it('prefers a local build over a prebuilt for the same platform', () => {
    // A stale prebuilt must not shadow a fresh `npm run build`, or the suite
    // reports on a binary nobody just built. The prebuilt here is deliberately
    // not loadable, so reaching for it at all fails the import.
    const out = runNode([
      '--input-type=module',
      '-e',
      `const fs = await import('node:fs');
       const os = await import('node:os');
       const path = await import('node:path');
       const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-precedence-'));
       fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ version: '0.0.0-test' }));
       fs.mkdirSync(path.join(tmp, 'dist'));
       fs.copyFileSync('dist/index.mjs', path.join(tmp, 'dist', 'index.mjs'));
       fs.mkdirSync(path.join(tmp, 'build', 'Release'), { recursive: true });
       fs.symlinkSync(
         path.resolve('build/Release/twilio_video_sdk_node.node'),
         path.join(tmp, 'build', 'Release', 'twilio_video_sdk_node.node'),
       );
       const platformDir = process.platform + '-' + process.arch;
       fs.mkdirSync(path.join(tmp, 'prebuilds', platformDir), { recursive: true });
       fs.writeFileSync(
         path.join(tmp, 'prebuilds', platformDir, 'twilio_video_sdk_node-' + platformDir + '.node'),
         'not a loadable addon',
       );
       const sdk = await import(path.join(tmp, 'dist', 'index.mjs'));
       if (typeof sdk.getVersion() !== 'string') throw new Error('addon did not load');
       console.log('precedence-ok');`,
    ]);
    expect(out).toBe('precedence-ok');
  });
});

/**
 * A Node process exits once nothing is left for it to do. These run a script
 * that never calls `process.exit` and require the process to end on its own,
 * which it cannot do while the SDK holds the event loop open.
 *
 * Requires `npm run build:ts` and a built addon.
 */
describe('process exit', () => {
  function exitsOnItsOwn(script: string): void {
    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: 10_000,
    });
    // A timeout kills the child with SIGTERM, so `signal` is set only when the
    // process was still running.
    expect(result.signal).toBeNull();
    expect(result.status).toBe(0);
  }

  it('exits after creating local tracks', () => {
    exitsOnItsOwn(
      `const sdk = require('./dist/index.cjs');
       sdk.createLocalVideoTrack('video');
       sdk.createLocalAudioTrack('audio');
       sdk.createLocalDataTrack('data');`,
    );
  });

  it('exits after a connect() rejected before reaching the network', () => {
    exitsOnItsOwn(
      `const sdk = require('./dist/index.cjs');
       sdk.connect('token', { preferredVideoCodecs: [1] }).then(
         () => { throw new Error('connect unexpectedly resolved'); },
         err => { if (!(err instanceof TypeError)) throw err; },
       );`,
    );
  });
});
