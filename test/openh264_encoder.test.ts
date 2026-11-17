/**
 * Checks that the OpenH264 encoder keeps its stream within H.264 level 3.1,
 * the level the encoder factory advertises and the SFU accepts. Skipped
 * unless OPENH264_PATH names an OpenH264 2.7 library, for example:
 *
 *   OPENH264_PATH=/path/to/libopenh264.so npx vitest run test/openh264_encoder.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadLocalAddon } from './helpers/openh264.js';

const OPENH264_PATH = process.env.OPENH264_PATH;

// Level 3.1's frame size limit (H.264 Table A-1), in 16x16 macroblocks.
const LEVEL_3_1 = 31;
const LEVEL_3_1_MAX_MACROBLOCKS = 3600;

const addon = OPENH264_PATH ? loadLocalAddon() : undefined;

// Brightness rises left to right and top to bottom, so a crop and a scale
// leave different values at the right and bottom edges.
function gradient(fx: number, fy: number): number {
  return 30 + 100 * fx + 100 * fy;
}

function lumaPlane(width: number, height: number): Buffer {
  const data = Buffer.alloc(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data[y * width + x] = Math.round(gradient(x / (width - 1), y / (height - 1)));
    }
  }
  return data;
}

// The level_idc of the first SPS in an Annex B stream: the third byte after
// the NAL header, ahead of any emulation prevention.
function spsLevel(bitstream: Buffer): number {
  for (let i = 0; i + 4 < bitstream.length; i++) {
    const startCode = bitstream[i] === 0 && bitstream[i + 1] === 0 && bitstream[i + 2] === 1;
    if (startCode && (bitstream[i + 3] & 0x1f) === 7) return bitstream[i + 6];
  }
  throw new Error('No SPS in the bitstream');
}

function macroblocks(width: number, height: number): number {
  return Math.ceil(width / 16) * Math.ceil(height / 16);
}

describe.skipIf(!OPENH264_PATH)('OpenH264 encoder level', () => {
  beforeAll(() => {
    addon!.loadOpenH264(OPENH264_PATH!);
  });

  it('labels a 1080p stream level 3.1', () => {
    const result = addon!.encodeH264Frame(1920, 1080, 30, lumaPlane(1920, 1080));
    expect(spsLevel(result.bitstream)).toBe(LEVEL_3_1);
  });

  it('scales a 1080p frame to 1280x720', () => {
    const result = addon!.encodeH264Frame(1920, 1080, 30, lumaPlane(1920, 1080));
    expect(result.decoded).toMatchObject({ width: 1280, height: 720 });
    expect({ width: result.encodedWidth, height: result.encodedHeight }).toEqual({
      width: 1280,
      height: 720,
    });
  });

  it('scales a 1080p frame rather than cropping it', () => {
    const { decoded } = addon!.encodeH264Frame(1920, 1080, 30, lumaPlane(1920, 1080));
    for (const [fx, fy] of [
      [0.95, 0.5],
      [0.5, 0.95],
      [0.05, 0.05],
    ]) {
      const x = Math.round(fx * (decoded.width - 1));
      const y = Math.round(fy * (decoded.height - 1));
      expect(Math.abs(decoded.luma[y * decoded.width + x] - gradient(fx, fy))).toBeLessThan(12);
    }
  });

  it('fits a 4:3 frame above the limit into level 3.1 at nearly the largest size it allows', () => {
    const result = addon!.encodeH264Frame(1440, 1080, 30, lumaPlane(1440, 1080));
    const { width, height } = result.decoded;
    expect(spsLevel(result.bitstream)).toBe(LEVEL_3_1);
    expect(macroblocks(width, height)).toBeLessThanOrEqual(LEVEL_3_1_MAX_MACROBLOCKS);
    expect(macroblocks(width, height)).toBeGreaterThan(0.95 * LEVEL_3_1_MAX_MACROBLOCKS);
    expect(Math.abs(width / height - 4 / 3)).toBeLessThan(16 / height);
  });

  it('labels 1280x720 at a 60 fps maximum level 3.1', () => {
    const result = addon!.encodeH264Frame(1280, 720, 60, lumaPlane(1280, 720));
    expect(spsLevel(result.bitstream)).toBe(LEVEL_3_1);
  });

  it('keeps 1280x720 at a 60 fps maximum at full size', () => {
    const { decoded } = addon!.encodeH264Frame(1280, 720, 60, lumaPlane(1280, 720));
    expect(decoded).toMatchObject({ width: 1280, height: 720 });
  });
});
