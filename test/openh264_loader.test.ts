import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildStub, loadLocalAddon } from './helpers/openh264.js';

// These tests call the addon's internal export directly, below the checks
// enableH264() adds. Requires a built addon.
const addon = loadLocalAddon();
let tmp: string;

const NO_SUCH_FILE = process.platform === 'darwin' ? 'no such file' : 'No such file or directory';
const NOT_A_LIBRARY =
  process.platform === 'darwin' ? 'not valid mach-o file' : 'invalid ELF header';

// The error for an unsupported version names the library's full version, then
// the accepted major.minor list.
const refusal = (version: string) =>
  new RegExp(
    `^OpenH264 ${version.replaceAll('.', '\\.')} at .* is not supported: this SDK accepts ` +
      'OpenH264 2\\.7\\. A newer OpenH264 needs a newer version of this SDK\\.$',
  );

describe('OpenH264 loader', () => {
  let supported: string;
  let olderMinor: string;
  let newerMinor: string;
  let newerMajor: string;
  let noDecoder: string;
  let newerMajorNoDecoder: string;

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openh264-loader-'));
    supported = buildStub(tmp, 'libopenh264-2.7.5.so', [2, 7, 5]);
    olderMinor = buildStub(tmp, 'libopenh264-2.6.0.so', [2, 6, 0]);
    newerMinor = buildStub(tmp, 'libopenh264-2.8.0.so', [2, 8, 0]);
    newerMajor = buildStub(tmp, 'libopenh264-3.7.0.so', [3, 7, 0]);
    noDecoder = buildStub(tmp, 'libopenh264-nodecoder.so', [2, 7, 0], ['STUB_OMIT_DECODER']);
    newerMajorNoDecoder = buildStub(
      tmp,
      'libopenh264-3.7.0-nodecoder.so',
      [3, 7, 0],
      ['STUB_OMIT_DECODER'],
    );
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('loads a library of the supported major.minor, whatever its revision', () => {
    expect(addon.loadOpenH264(supported)).toEqual({ major: 2, minor: 7, revision: 5 });
  });

  it('reports the dlerror() text for a missing library', () => {
    const missing = path.join(tmp, 'missing.so');
    expect(() => addon.loadOpenH264(missing)).toThrow(NO_SUCH_FILE);
  });

  it('reports the dlerror() text for a file that is not a shared library', () => {
    const notALibrary = path.join(tmp, 'not-a-library.so');
    // Longer than an ELF header, so Linux reports the bad magic rather than a short file.
    fs.writeFileSync(notALibrary, 'This is a text file, not a shared library. '.repeat(4));
    expect(() => addon.loadOpenH264(notALibrary)).toThrow(NOT_A_LIBRARY);
  });

  it('refuses an older minor version', () => {
    expect(() => addon.loadOpenH264(olderMinor)).toThrow(refusal('2.6.0'));
  });

  it('refuses a newer minor version', () => {
    expect(() => addon.loadOpenH264(newerMinor)).toThrow(refusal('2.8.0'));
  });

  it('refuses a different major version with the same minor', () => {
    expect(() => addon.loadOpenH264(newerMajor)).toThrow(refusal('3.7.0'));
  });

  it('names an entry point the library does not export', () => {
    expect(() => addon.loadOpenH264(noDecoder)).toThrow('WelsCreateDecoder');
  });

  it('reports an unsupported version even when an entry point is missing', () => {
    expect(() => addon.loadOpenH264(newerMajorNoDecoder)).toThrow(refusal('3.7.0'));
  });

  it('loads a bare file name from the working directory', () => {
    // Fails on Linux without the loader's './' prefix, since glibc never
    // searches the working directory. macOS dyld does, so it passes there either way.
    const cwd = process.cwd();
    process.chdir(tmp);
    try {
      expect(addon.loadOpenH264('libopenh264-2.7.5.so')).toEqual({
        major: 2,
        minor: 7,
        revision: 5,
      });
    } finally {
      process.chdir(cwd);
    }
  });
});
