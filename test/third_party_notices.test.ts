import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Reads the file out of the packed tarball, so a file that exists in the repo
// but is missing from package.json "files" still fails.
let tmp: string;
let notices: string | null;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'third-party-notices-'));

  const pack = spawnSync(
    'npm',
    ['pack', '--ignore-scripts', '--pack-destination', tmp, '--silent'],
    { cwd: path.join(__dirname, '..'), encoding: 'utf8' },
  );
  if (pack.status !== 0) {
    throw new Error(`npm pack failed: ${pack.stderr}`);
  }
  const tarball = path.join(tmp, pack.stdout.trim().split('\n').pop()!);

  const extract = spawnSync('tar', ['-xzOf', tarball, 'package/THIRD_PARTY_NOTICES'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  notices = extract.status === 0 ? extract.stdout : null;
}, 120000);

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('THIRD_PARTY_NOTICES in the packed tarball', () => {
  it('is included in the package', () => {
    expect(notices).not.toBeNull();
  });

  it('has an OpenH264 entry with the BSD 2-Clause license text', () => {
    const entry = notices?.match(/^### openh264\n\n([\s\S]*?)(?=^### |(?![\s\S]))/m)?.[1];

    expect(entry).toContain('Copyright (c) 2013, Cisco Systems');
    expect(entry).toContain('Redistributions in binary form must reproduce the above copyright');
  });

  it.each(['webrtc', 'boringssl', 'boost', 'node-addon-api', 'node-api-headers', 'openh264'])(
    'has a %s entry',
    name => {
      expect(notices).toMatch(new RegExp(`^### ${name}$`, 'm'));
    },
  );

  it('has no HTML-escaped license text', () => {
    expect(notices).not.toBeNull();
    expect(notices).not.toMatch(/&(quot|amp|lt|gt|#x27);/);
  });
});
