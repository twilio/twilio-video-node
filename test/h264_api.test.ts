import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  enableH264,
  isH264Enabled,
  createLocalDataTrack,
  H264LibraryLoadError,
  SDK_LOCAL_CODE,
} from '../lib/index.js';
import { buildStub, loadLocalAddon } from './helpers/openh264.js';

// Every call here is refused, so no library is ever loaded: the internal
// videoCodecFormats() staying null shows the native side agrees. The last test
// creates the default media factory, which can't be undone in this process.
const addon = loadLocalAddon();
let tmp: string;
let supported: string;

function expectNothingLoaded() {
  expect(isH264Enabled()).toBe(false);
  expect(addon.videoCodecFormats()).toBeNull();
}

describe('enableH264() refusals', () => {
  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'h264-api-'));
    supported = buildStub(tmp, 'libopenh264-2.7.0.so', [2, 7, 0]);
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it.each([
    ['missing', undefined],
    ['the string "true"', 'true'],
    ['1', 1],
  ])('throws TypeError without loading when confirmPatentLicensingCompliance is %s', (_, value) => {
    const options = { openh264Path: supported, confirmPatentLicensingCompliance: value };
    // @ts-expect-error testing runtime validation of a non-literal-true value
    expect(() => enableH264(options)).toThrow(TypeError);
    expectNothingLoaded();
  });

  it('throws TypeError without loading when openh264Path is empty', () => {
    expect(() => enableH264({ openh264Path: '', confirmPatentLicensingCompliance: true })).toThrow(
      TypeError,
    );
    expectNothingLoaded();
  });

  it('throws TypeError without loading when openh264Path contains a NUL', () => {
    // dlopen() would stop at the NUL and load the file named by the prefix.
    expect(() =>
      enableH264({ openh264Path: `${supported}\0.bak`, confirmPatentLicensingCompliance: true }),
    ).toThrow(TypeError);
    expectNothingLoaded();
  });

  it('does not warn when a call is refused', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // @ts-expect-error testing runtime validation
      expect(() => enableH264({ openh264Path: supported })).toThrow(TypeError);
      expect(() =>
        enableH264({
          openh264Path: path.join(tmp, 'missing.so'),
          confirmPatentLicensingCompliance: true,
        }),
      ).toThrow(H264LibraryLoadError);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('throws H264LibraryLoadError carrying the loader text for a missing library', () => {
    const missing = path.join(tmp, 'missing.so');
    let error: unknown;
    try {
      enableH264({ openh264Path: missing, confirmPatentLicensingCompliance: true });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(H264LibraryLoadError);
    expect((error as H264LibraryLoadError).code).toBe(SDK_LOCAL_CODE);
    expect((error as H264LibraryLoadError).message).toContain(missing);
    expect((error as Error).cause).toBeInstanceOf(Error);
    expectNothingLoaded();
  });

  it('throws H264LibraryLoadError for a library that is not OpenH264 2.7', () => {
    const olderMinor = buildStub(tmp, 'libopenh264-2.6.0.so', [2, 6, 0]);
    expect(() =>
      enableH264({ openh264Path: olderMinor, confirmPatentLicensingCompliance: true }),
    ).toThrow(H264LibraryLoadError);
    expect(() =>
      enableH264({ openh264Path: olderMinor, confirmPatentLicensingCompliance: true }),
    ).toThrow(/2\.6\.0.*accepts OpenH264 2\.7\./);
    expectNothingLoaded();
  });

  // glibc reports a library built for another machine as "No such file or
  // directory", the same as a missing file. macOS names the architecture.
  it.runIf(process.platform === 'linux')(
    'says the file exists when glibc reports a wrong-architecture library as missing',
    () => {
      const otherArch = path.join(tmp, 'libopenh264-aarch64.so');
      fs.writeFileSync(otherArch, elfHeader(183 /* EM_AARCH64 */));
      expect(() =>
        enableH264({ openh264Path: otherArch, confirmPatentLicensingCompliance: true }),
      ).toThrow(/No such file or directory.*The file exists/);
      expectNothingLoaded();
    },
  );

  it.runIf(process.platform === 'linux')(
    'does not blame the architecture when a dependency of the library is missing',
    () => {
      const dep = path.join(tmp, 'libh264dep.so');
      execFileSync('cc', ['-shared', '-fPIC', '-x', 'c', '-', '-o', dep], {
        input: 'int h264dep(void) { return 0; }',
      });
      // --no-as-needed keeps the unused dependency in the stub's DT_NEEDED.
      const needsDep = buildStub(
        tmp,
        'libopenh264-needs-dep.so',
        [2, 7, 0],
        [],
        ['-Wl,--no-as-needed', `-L${tmp}`, '-lh264dep'],
      );
      fs.rmSync(dep);
      let error: unknown;
      try {
        enableH264({ openh264Path: needsDep, confirmPatentLicensingCompliance: true });
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(H264LibraryLoadError);
      expect((error as Error).message).toMatch(/libh264dep\.so: cannot open shared object file/);
      expect((error as Error).message).not.toMatch(/The file exists/);
      expectNothingLoaded();
    },
  );

  it('throws without loading once the default media factory exists', () => {
    createLocalDataTrack();
    expect(() =>
      enableH264({ openh264Path: supported, confirmPatentLicensingCompliance: true }),
    ).toThrow(/before the first connect\(\) or createLocal\*Track\(\)/);
    expectNothingLoaded();
  });
});

// A 64-bit little-endian ELF header for a shared object, valid apart from its machine.
function elfHeader(machine: number): Buffer {
  const header = Buffer.alloc(64);
  header.write('\x7fELF', 0, 'latin1');
  header[4] = 2; // ELFCLASS64
  header[5] = 1; // ELFDATA2LSB
  header[6] = 1; // EV_CURRENT
  header.writeUInt16LE(3, 16); // ET_DYN
  header.writeUInt16LE(machine, 18);
  header.writeUInt32LE(1, 20); // e_version
  header.writeUInt16LE(64, 52); // e_ehsize
  header.writeUInt16LE(56, 54); // e_phentsize
  return header;
}
