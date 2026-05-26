import { describe, it, expect } from 'vitest';
import {
  getVersion,
  setLogLevel,
  connect,
  createLocalVideoTrack,
  createLocalAudioTrack,
  createLocalDataTrack,
} from '../dist/index.mjs';
import { generateI420Frame, generateAudioSamples } from './helpers/media.js';

describe('Version', () => {
  it('getVersion returns string', () => {
    const version = getVersion();
    expect(typeof version).toBe('string');
    expect(version.length).toBeGreaterThan(0);
  });
});

describe('Log Level', () => {
  it('setLogLevel accepts valid levels', () => {
    const levels = ['off', 'fatal', 'error', 'warning', 'info', 'debug', 'trace', 'all'] as const;
    levels.forEach(level => {
      expect(() => setLogLevel(level)).not.toThrow();
    });
  });

  it('setLogLevel rejects invalid level', () => {
    expect(() => setLogLevel('invalid' as any)).toThrow(/Invalid log level/);
  });
});

describe('connect() validation', () => {
  it('rejects with empty token', async () => {
    await expect(connect('')).rejects.toThrow(/token/i);
  });

  it('rejects with non-string token', async () => {
    // @ts-expect-error testing runtime validation
    await expect(connect(123)).rejects.toThrow(/token/i);
  });
});

describe('createLocalVideoTrack validation', () => {
  it('throws on empty string name', () => {
    expect(() => createLocalVideoTrack('')).toThrow(/name/i);
  });
});

describe('createLocalAudioTrack validation', () => {
  it('throws on empty string name', () => {
    expect(() => createLocalAudioTrack('')).toThrow(/name/i);
  });
});

describe('Video Track', () => {
  it('createLocalVideoTrack creates track', () => {
    const track = createLocalVideoTrack('test-video');

    expect(track).toBeDefined();
    expect(track.name).toBe('test-video');
    expect(track.kind).toBe('video');
    expect(track.enabled).toBe(true);
  });

  it('track can be disabled', () => {
    const track = createLocalVideoTrack('disable-test');

    track.enabled = false;
    expect(track.enabled).toBe(false);

    track.enabled = true;
    expect(track.enabled).toBe(true);
  });

  it('write returns false on unpublished track (no encoder sink attached)', () => {
    const track = createLocalVideoTrack('push-test');

    const frame = generateI420Frame(320, 240);
    const result = track.write({
      y: frame.y,
      u: frame.u,
      v: frame.v,
      width: 320,
      height: 240,
      yStride: 320,
      uStride: 160,
      vStride: 160,
      timestampNs: process.hrtime.bigint(),
    });
    expect(result).toBe(false);
  });
});

describe('Audio Track', () => {
  it('createLocalAudioTrack creates track', () => {
    const track = createLocalAudioTrack('test-audio');

    expect(track).toBeDefined();
    expect(track.name).toBe('test-audio');
    expect(track.kind).toBe('audio');
    expect(track.enabled).toBe(true);
  });

  it('track can be disabled', () => {
    const track = createLocalAudioTrack('disable-test');

    track.enabled = false;
    expect(track.enabled).toBe(false);

    track.enabled = true;
    expect(track.enabled).toBe(true);
  });

  it('write accepts audio samples and returns true', () => {
    const track = createLocalAudioTrack('push-test');

    const samples = generateAudioSamples(480, 48000, 1);
    const result = track.write({
      pcm: samples,
      frames: 480,
    });
    expect(result).toBe(true);
  });
});

describe('Data Track', () => {
  // rtc-cpp uses UINT16_MAX when maxRetransmits/maxPacketLifeTime are unset (reliable mode)
  const RELIABLE_DEFAULT = 65535;

  it('creates a named data track with expected defaults', () => {
    const track = createLocalDataTrack('my-channel');
    expect(track.name).toBe('my-channel');
    expect(track.ordered).toBe(true);
    expect(track.reliable).toBe(true);
    expect(track.maxRetransmits).toBe(RELIABLE_DEFAULT);
    expect(track.maxPacketLifeTime).toBe(RELIABLE_DEFAULT);
  });

  it('creates a data track with defaults when called with no arguments', () => {
    const track = createLocalDataTrack();
    expect(track.name).toBeDefined();
    expect(track.ordered).toBe(true);
    expect(track.reliable).toBe(true);
    expect(track.maxRetransmits).toBe(RELIABLE_DEFAULT);
    expect(track.maxPacketLifeTime).toBe(RELIABLE_DEFAULT);
  });

  it('accepts maxRetransmits option', () => {
    const track = createLocalDataTrack({ name: 'retransmit-track', maxRetransmits: 3 });
    expect(track.name).toBe('retransmit-track');
    expect(track.maxRetransmits).toBe(3);
    expect(track.maxPacketLifeTime).toBe(RELIABLE_DEFAULT);
    expect(track.reliable).toBe(false);
    expect(track.ordered).toBe(true);
  });

  it('accepts maxPacketLifeTime option', () => {
    const track = createLocalDataTrack({ name: 'lifetime-track', maxPacketLifeTime: 1000 });
    expect(track.name).toBe('lifetime-track');
    expect(track.maxPacketLifeTime).toBe(1000);
    expect(track.maxRetransmits).toBe(RELIABLE_DEFAULT);
    expect(track.reliable).toBe(false);
    expect(track.ordered).toBe(true);
  });

  it('accepts ordered: false', () => {
    const track = createLocalDataTrack({ name: 'unordered', ordered: false });
    expect(track.ordered).toBe(false);
    expect(track.reliable).toBe(true);
  });

  it('throws when both maxRetransmits and maxPacketLifeTime are set', () => {
    expect(() => createLocalDataTrack({ maxRetransmits: 3, maxPacketLifeTime: 1000 })).toThrow(
      'maxRetransmits and maxPacketLifeTime are mutually exclusive',
    );
  });

  it('throws on negative maxRetransmits', () => {
    expect(() => createLocalDataTrack({ maxRetransmits: -1 })).toThrow(
      'maxRetransmits and maxPacketLifeTime must be non-negative',
    );
  });

  it('throws on negative maxPacketLifeTime', () => {
    expect(() => createLocalDataTrack({ maxPacketLifeTime: -1 })).toThrow(
      'maxRetransmits and maxPacketLifeTime must be non-negative',
    );
  });

  it('send does not throw on disconnected track', () => {
    const track = createLocalDataTrack('send-test');
    expect(track.name).toBe('send-test');
    expect(() => track.send('hello')).not.toThrow();
    expect(() => track.send(Buffer.from([0xde, 0xad]))).not.toThrow();
  });
});
