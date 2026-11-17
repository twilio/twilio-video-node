import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { enableH264, isH264Enabled, connect, H264LibraryLoadError } from '../lib/index.js';
import { buildStub } from './helpers/openh264.js';

// A loaded library stays loaded for the rest of this file's process, and the
// connect() in the last test creates the default media factory, after which
// enableH264() throws. So these run in order.
const WARNING =
  'H.264 enabled via user-provided library. The developer is responsible for obtaining all applicable patent licenses.';
let tmp: string;
let supported: string;

describe('enableH264() with a supported library', () => {
  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'h264-enable-'));
    supported = buildStub(tmp, 'libopenh264-2.7.0.so', [2, 7, 0]);
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('enables H.264 after a connect() refused for preferring H264 too early', async () => {
    expect(isH264Enabled()).toBe(false);
    await expect(connect('token', { preferredVideoCodecs: ['H264'] })).rejects.toThrow(
      /H264 requires enableH264\(\)/,
    );
    enableH264({ openh264Path: supported, confirmPatentLicensingCompliance: true });
    expect(isH264Enabled()).toBe(true);
  });

  it('warns about patent licensing on every successful call', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      enableH264({ openh264Path: supported, confirmPatentLicensingCompliance: true });
      enableH264({ openh264Path: supported, confirmPatentLicensingCompliance: true });
      expect(warn.mock.calls).toEqual([[WARNING], [WARNING]]);
    } finally {
      warn.mockRestore();
    }
  });

  it('loads the library a later call names', () => {
    const olderMinor = buildStub(tmp, 'libopenh264-2.6.0.so', [2, 6, 0]);
    expect(() =>
      enableH264({ openh264Path: olderMinor, confirmPatentLicensingCompliance: true }),
    ).toThrow(H264LibraryLoadError);
    expect(isH264Enabled()).toBe(true);
  });

  it('accepts H264 in preferredVideoCodecs', async () => {
    // Codecs are parsed before videoEncodingMode, so an error about the mode
    // means H264 got through without connecting anywhere.
    await expect(
      // @ts-expect-error testing runtime validation of the mode
      connect('token', { preferredVideoCodecs: ['H264', 'VP8'], videoEncodingMode: 'manual' }),
    ).rejects.toThrow(/Unknown videoEncodingMode: manual/);
  });
});
