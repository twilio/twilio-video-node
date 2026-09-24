import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, mkdirSync, cpSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

/**
 * `package.json` points consumers at the bundle through three mechanisms that
 * are resolved by different tools: `exports` (modern TypeScript and Node),
 * `main`/`module` (bundlers and Node's legacy lookup), and the top-level
 * `types` (TypeScript's `moduleResolution: "node"`, still the default for a
 * `module: "commonjs"` project). Nothing else in the suite reads those fields,
 * so a stale one ships silently: a wrong `types` target leaves legacy-config
 * consumers with an implicit `any` for the whole SDK and no error unless they
 * compile with `noImplicitAny`.
 *
 * Requires `npm run build:ts` to have produced `dist/`.
 */
describe('package manifest', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const pkg = require('../package.json');

  /** Every string leaf under `exports`, which may nest by condition. */
  function exportTargets(node: unknown): string[] {
    if (typeof node === 'string') {
      return [node];
    }
    if (node && typeof node === 'object') {
      return Object.values(node).flatMap(exportTargets);
    }
    return [];
  }

  const referenced = [
    ...(['main', 'module', 'types'] as const).map(field => [field, pkg[field]] as const),
    ...exportTargets(pkg.exports).map(target => ['exports', target] as const),
  ].filter(([, target]) => typeof target === 'string');

  it('references entry points that exist on disk', () => {
    expect(referenced.length).toBeGreaterThan(0);

    const missing = referenced.filter(
      ([, target]) => !existsSync(path.join(root, target.replace(/^\.\//, ''))),
    );

    expect(missing).toEqual([]);
  });

  it('references entry points that the files allowlist actually packs', () => {
    const allowed: string[] = pkg.files;

    const unpacked = referenced.filter(([, target]) => {
      const rel = target.replace(/^\.\//, '');
      return !allowed.some(entry => rel === entry || rel.startsWith(`${entry}/`));
    });

    expect(unpacked).toEqual([]);
  });
});

/**
 * The manifest checks above prove the entry points exist; they cannot prove a
 * consumer's compiler finds them. This compiles a throwaway project against a
 * staged copy of the package under the three `moduleResolution` settings a
 * consumer can realistically be on. `node` is the one that matters here: it
 * ignores `exports` entirely and is the only mode that reads the top-level
 * `types`, so it is the mode a wrong `types` target breaks, and `strict` is on
 * because without `noImplicitAny` an unresolved type silently becomes `any`
 * and the compile still succeeds.
 *
 * Requires `npm run build:ts` to have produced `dist/`.
 */
describe('type resolution for consumers', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const pkg = require('../package.json');
  const tsc = require.resolve('typescript/bin/tsc');

  let fixture: string;

  beforeAll(() => {
    fixture = mkdtempSync(path.join(tmpdir(), 'video-node-sdk-types-'));

    const staged = path.join(fixture, 'node_modules', ...pkg.name.split('/'));
    mkdirSync(staged, { recursive: true });
    cpSync(path.join(root, 'dist'), path.join(staged, 'dist'), { recursive: true });
    cpSync(path.join(root, 'package.json'), path.join(staged, 'package.json'));

    writeFileSync(
      path.join(fixture, 'consumer.ts'),
      `import { connect, type Room } from '${pkg.name}';\n` +
        `export const connectFn: typeof connect = connect;\n` +
        `export type ConnectedRoom = Room;\n`,
    );
  });

  afterAll(() => {
    if (fixture) {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  // `module` is pinned per mode because TypeScript rejects mismatched pairs.
  const modes = [
    ['node', 'commonjs'],
    ['node16', 'node16'],
    ['bundler', 'esnext'],
  ] as const;

  it.each(modes)(
    'resolves types under moduleResolution %s',
    (moduleResolution, module) => {
      const config = path.join(fixture, `tsconfig.${moduleResolution}.json`);

      writeFileSync(
        config,
        JSON.stringify({
          compilerOptions: {
            module,
            moduleResolution,
            target: 'es2022',
            strict: true,
            noEmit: true,
            // Check the shipped declarations too; otherwise a reference to a
            // type missing from the bundle silently becomes `any`.
            skipLibCheck: false,
            // The declarations use Node types such as Buffer.
            typeRoots: [path.join(root, 'node_modules', '@types')],
            types: ['node'],
          },
          files: ['consumer.ts'],
        }),
      );

      const result = spawnSync(process.execPath, [tsc, '-p', config], {
        cwd: fixture,
        encoding: 'utf8',
      });

      expect(`${result.stdout}${result.stderr}`.trim()).toBe('');
      expect(result.status).toBe(0);
    },
    60000,
  );
});
