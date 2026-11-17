import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { NativeVideoFormat } from '../lib/types.js';
import { buildStub, loadLocalAddon } from './helpers/openh264.js';

// A loaded library stays loaded for the rest of this file's process, so these
// tests run in order: the failed load first, then the successful one.
const addon = loadLocalAddon();
let tmp: string;

// What the SFU and browsers negotiate: Constrained Baseline level 3.1,
// non-interleaved packetization.
const H264_PARAMETERS = {
  'profile-level-id': '42e01f',
  'packetization-mode': '1',
  'level-asymmetry-allowed': '1',
};

function h264Formats(formats: NativeVideoFormat[]): NativeVideoFormat[] {
  return formats.filter(f => f.name === 'H264');
}

// Codec names in order, once each: a codec can appear once per profile.
function codecNames(formats: NativeVideoFormat[]): string[] {
  return [...new Set(formats.map(f => f.name))];
}

describe('OpenH264 video codec factories', () => {
  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openh264-factories-'));
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('leaves the built-in factories in place after a failed load', () => {
    const olderMinor = buildStub(tmp, 'libopenh264-2.6.0.so', [2, 6, 0]);
    expect(() => addon.loadOpenH264(olderMinor)).toThrow();
    expect(addon.videoCodecFormats()).toBeNull();
  });

  it('adds Constrained Baseline H.264 after the built-in codecs once a library is loaded', () => {
    addon.loadOpenH264(buildStub(tmp, 'libopenh264-2.7.0.so', [2, 7, 0]));
    const formats = addon.videoCodecFormats();
    expect(formats).not.toBeNull();
    // The built-in codecs are rtc-cpp's: libvpx VP8 and VP9 both ways, plus dav1d AV1 for decoding.
    expect(codecNames(formats!.encoders)).toEqual(['VP8', 'VP9', 'H264']);
    expect(codecNames(formats!.decoders)).toEqual(['VP8', 'VP9', 'AV1', 'H264']);
    for (const list of [formats!.encoders, formats!.decoders]) {
      expect(h264Formats(list)).toEqual([{ name: 'H264', parameters: H264_PARAMETERS }]);
    }
  });
});
