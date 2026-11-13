import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The script uses its parent directory as the checkout, so each run copies it
// into a throwaway one. Shims stand in for curl and record tar's view of the run.
const archDir = ({ x64: 'x86_64', arm64: 'arm64' } as Record<string, string>)[process.arch];

let work: string;
let validArchive: string;
let corruptArchive: string;
let shimDir: string;

beforeAll(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'fetch-deps-test-'));

  // The smallest layout the script accepts after extraction.
  const src = path.join(work, 'archive-src');
  const libDir = path.join(src, 'twilio-video', 'lib', archDir, 'appleclang-test', 'release');
  fs.mkdirSync(path.join(src, 'twilio-video', 'include'), { recursive: true });
  fs.mkdirSync(libDir, { recursive: true });
  for (const lib of ['libtwilio-video.a', 'libwebrtc.a', 'libjsoncpp.a']) {
    fs.writeFileSync(path.join(libDir, lib), '');
  }
  validArchive = path.join(work, 'valid.tar.bz2');
  execFileSync('tar', ['cjf', validArchive, '-C', src, 'twilio-video']);

  corruptArchive = path.join(work, 'corrupt.tar.bz2');
  fs.writeFileSync(corruptArchive, 'not a bzip2 stream');

  const realTar = execFileSync('sh', ['-c', 'command -v tar'], { encoding: 'utf8' }).trim();
  shimDir = path.join(work, 'bin');
  fs.mkdirSync(shimDir);
  fs.writeFileSync(
    path.join(shimDir, 'tar'),
    '#!/bin/sh\n' +
      'printf "%s\\n" "$@" > "$SHIM_OUT/args"\n' +
      'ls -A "$SHIM_ROOT" > "$SHIM_OUT/root"\n' +
      `exec "${realTar}" "$@"\n`,
    { mode: 0o755 },
  );
  // Serves CURL_SERVES as the download, written to the path after `-o`.
  fs.writeFileSync(
    path.join(shimDir, 'curl'),
    '#!/bin/sh\n' +
      'while [ $# -gt 0 ]; do [ "$1" = "-o" ] && out="$2"; shift; done\n' +
      'cat > /dev/null\n' +
      'exec cp "$CURL_SERVES" "$out"\n',
    { mode: 0o755 },
  );
});

afterAll(() => {
  fs.rmSync(work, { recursive: true, force: true });
});

interface RunOptions {
  /** Passed as RTC_CPP_ARCHIVE. */
  local?: string;
  /** Served by the curl shim, with RTC_CPP_ARTIFACTORY_TOKEN set. */
  download?: string;
  /** Copied into the checkout's deps/ and passed as RTC_CPP_ARCHIVE. */
  localInDeps?: string;
  /** Spells deps/ as DEPS/ in RTC_CPP_ARCHIVE. */
  upperCaseDeps?: boolean;
  pin?: boolean;
  tmpDirExists?: boolean;
}

/** Runs a copy of the script in a fresh checkout, with its own TMPDIR. */
function run({
  local,
  localInDeps,
  upperCaseDeps = false,
  download,
  pin = true,
  tmpDirExists = true,
}: RunOptions) {
  const dir = fs.mkdtempSync(path.join(work, 'run-'));
  const root = path.join(dir, 'checkout');
  const tmpDir = path.join(dir, 'tmp');
  const shimOut = path.join(dir, 'shim');
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  if (tmpDirExists) fs.mkdirSync(tmpDir);
  fs.mkdirSync(shimOut);
  const script = path.join(root, 'scripts', 'fetch-deps.js');
  fs.copyFileSync(path.join(__dirname, '..', 'scripts', 'fetch-deps.js'), script);
  if (pin) fs.writeFileSync(path.join(root, '.rtc-cpp-version'), '0.0.0\n');

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${shimDir}${path.delimiter}${process.env.PATH}`,
    TMPDIR: tmpDir,
    SHIM_OUT: shimOut,
    SHIM_ROOT: root,
    ARTIFACTORY_URL: 'http://127.0.0.1:1',
  };
  // The developer's own settings would change which path the script takes.
  for (const name of [
    'RTC_CPP_ARCHIVE',
    'RTC_CPP_ARTIFACTORY_TOKEN',
    'RTC_CPP_VERSION',
    'RTC_CPP_BUILD_TYPE',
    'RTC_CPP_ARCH',
    'MAVEN_REPO',
  ]) {
    delete env[name];
  }
  if (local) env.RTC_CPP_ARCHIVE = local;
  if (localInDeps) {
    fs.mkdirSync(path.join(root, 'deps'));
    fs.copyFileSync(localInDeps, path.join(root, 'deps', 'archive.tar.bz2'));
    env.RTC_CPP_ARCHIVE = path.join(root, upperCaseDeps ? 'DEPS' : 'deps', 'archive.tar.bz2');
  }
  if (download) {
    env.RTC_CPP_ARTIFACTORY_TOKEN = 'test-token';
    env.CURL_SERVES = download;
  }

  const result = spawnSync(process.execPath, [script], { encoding: 'utf8', env });
  const read = (name: string) => fs.readFileSync(path.join(shimOut, name), 'utf8').split('\n');

  return {
    result,
    tmpDir,
    local: env.RTC_CPP_ARCHIVE,
    tarArgs: () => read('args'),
    rootAtExtract: () => read('root'),
  };
}

describe('fetch-deps downloaded archive', () => {
  it('extracts from the OS temp dir, with no archive in the checkout', () => {
    const { result, tmpDir, tarArgs, rootAtExtract } = run({ download: validArchive });

    expect(result.status, result.stderr).toBe(0);
    const archive = tarArgs()[1];
    expect(archive.startsWith(tmpDir + path.sep), `archive at ${archive}`).toBe(true);
    expect(rootAtExtract().filter(Boolean).sort()).toEqual(['.rtc-cpp-version', 'deps', 'scripts']);
  });

  it('is removed after a successful run', () => {
    const { result, tmpDir } = run({ download: validArchive });

    expect(result.status, result.stderr).toBe(0);
    expect(fs.readdirSync(tmpDir)).toEqual([]);
  });

  it('is removed when extraction fails', () => {
    const { result, tmpDir } = run({ download: corruptArchive });

    expect(result.status).toBe(1);
    expect(fs.readdirSync(tmpDir)).toEqual([]);
  });

  it('leaves nothing in the OS temp dir when the version pin is missing', () => {
    const { result, tmpDir } = run({ download: validArchive, pin: false });

    expect(result.status).toBe(1);
    expect(fs.readdirSync(tmpDir)).toEqual([]);
  });

  it('reports a missing OS temp dir as a fetch-deps failure', () => {
    const { result } = run({ download: validArchive, tmpDirExists: false });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^\[fetch-deps\] Failed: .*ENOENT/m);
  });
});

describe('fetch-deps local archive', () => {
  it('is extracted in place, without a copy', () => {
    const { result, tarArgs } = run({ local: validArchive });

    expect(result.status, result.stderr).toBe(0);
    expect(tarArgs()[1]).toBe(validArchive);
  });

  it('is extracted when its path has shell metacharacters', () => {
    const odd = path.join(work, 'a $HOME `x` "q".tar.bz2');
    fs.copyFileSync(validArchive, odd);

    const { result } = run({ local: odd });

    expect(result.status, result.stderr).toBe(0);
  });

  it('is refused, and kept, when it is inside deps/', () => {
    const { result, local } = run({ localInDeps: validArchive });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^\[fetch-deps\] Failed: .*outside deps\//m);
    expect(fs.existsSync(local!)).toBe(true);
  });

  // The default macOS volume is case-insensitive, so DEPS/ is deps/ there.
  it.runIf(process.platform === 'darwin')('is refused when deps/ is spelled DEPS/', () => {
    const { result, local } = run({ localInDeps: validArchive, upperCaseDeps: true });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^\[fetch-deps\] Failed: .*outside deps\//m);
    expect(fs.existsSync(local!)).toBe(true);
  });

  it('is kept when extraction fails', () => {
    const { result } = run({ local: corruptArchive });

    expect(result.status).toBe(1);
    expect(fs.existsSync(corruptArchive)).toBe(true);
  });
});
