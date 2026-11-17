import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NativeAddon } from '../../lib/types.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The local addon build, for tests of its internal exports. The addon is one
 * instance per process, so a library loaded through it stays loaded for every
 * later test in the same file.
 */
function loadLocalAddon(): NativeAddon {
  const nativeRequire = createRequire(import.meta.url);
  for (const buildType of ['Release', 'Debug']) {
    const addonPath = path.join(ROOT, 'build', buildType, 'twilio_video_sdk_node.node');
    if (fs.existsSync(addonPath)) return nativeRequire(addonPath);
  }
  throw new Error('No local addon build; run `npm run build`');
}

/**
 * Compiles test/fixtures/openh264_stub.c into `dir/name`, a shared library
 * that reports the given version. Built for this process's architecture, since
 * x64 Node runs under Rosetta on Apple silicon, where `cc` defaults to arm64.
 */
function buildStub(
  dir: string,
  name: string,
  version: [number, number, number],
  extraDefines: string[] = [],
  linkArgs: string[] = [],
): string {
  const out = path.join(dir, name);
  const archFlags =
    process.platform === 'darwin'
      ? ['-arch', process.arch === 'x64' ? 'x86_64' : process.arch]
      : [];
  execFileSync('cc', [
    '-shared',
    '-fPIC',
    ...archFlags,
    `-DSTUB_MAJOR=${version[0]}`,
    `-DSTUB_MINOR=${version[1]}`,
    `-DSTUB_REVISION=${version[2]}`,
    ...extraDefines.map(d => `-D${d}`),
    path.join(ROOT, 'test', 'fixtures', 'openh264_stub.c'),
    ...linkArgs,
    '-o',
    out,
  ]);
  return out;
}

export { loadLocalAddon, buildStub };
