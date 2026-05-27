import { describe, it, expect } from 'vitest';
import {
  getVersion,
  setLogLevel,
  connect,
  createLocalVideoTrack,
  createLocalAudioTrack,
  createLocalDataTrack,
  createLocalTracks,
  TwilioError,
  AccessTokenInvalidError,
  RoomNotFoundError,
  SignalingConnectionError,
  MediaConnectionError,
  ParticipantMaxTracksExceededError,
  twilioErrorFromCode,
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

describe('createLocalTracks', () => {
  it('returns audio + video by default', async () => {
    const tracks = await createLocalTracks();
    expect(tracks).toHaveLength(2);
    const kinds = tracks.map(t => t.kind).sort();
    expect(kinds).toEqual(['audio', 'video']);
  });

  it('returns only audio when video is false', async () => {
    const tracks = await createLocalTracks({ audio: true, video: false });
    expect(tracks).toHaveLength(1);
    expect(tracks[0].kind).toBe('audio');
  });

  it('returns only video when audio is false', async () => {
    const tracks = await createLocalTracks({ audio: false, video: true });
    expect(tracks).toHaveLength(1);
    expect(tracks[0].kind).toBe('video');
  });

  it('returns empty array when both are false', async () => {
    const tracks = await createLocalTracks({ audio: false, video: false });
    expect(tracks).toHaveLength(0);
  });

  it('passes per-track options through', async () => {
    const tracks = await createLocalTracks({
      audio: { name: 'mic-1' },
      video: { name: 'cam-1' },
    });
    expect(tracks.find(t => t.kind === 'audio')!.name).toBe('mic-1');
    expect(tracks.find(t => t.kind === 'video')!.name).toBe('cam-1');
  });
});

describe('connect() networkQuality validation', () => {
  it('rejects verbosity > 1', async () => {
    await expect(
      // @ts-expect-error testing runtime validation
      connect('fake-token', { networkQuality: { local: 3 } }),
    ).rejects.toThrow(/networkQuality\.local/);
  });

  it('rejects negative verbosity', async () => {
    await expect(
      // @ts-expect-error testing runtime validation
      connect('fake-token', { networkQuality: { remote: -1 } }),
    ).rejects.toThrow(/networkQuality\.remote/);
  });
});

describe('TwilioError hierarchy', () => {
  it('TwilioError is an Error subclass with code', () => {
    const err = new TwilioError(99999, 'oops');
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe(99999);
    expect(err.message).toBe('oops');
    expect(err.name).toBe('TwilioError');
  });

  it('AccessTokenInvalidError carries code 20101', () => {
    const err = new AccessTokenInvalidError();
    expect(err).toBeInstanceOf(TwilioError);
    expect(err.code).toBe(20101);
    expect(err.name).toBe('AccessTokenInvalidError');
  });

  it('SignalingConnectionError carries code 53000', () => {
    expect(new SignalingConnectionError().code).toBe(53000);
  });

  it('RoomNotFoundError carries code 53106', () => {
    expect(new RoomNotFoundError().code).toBe(53106);
  });

  it('MediaConnectionError carries code 53405', () => {
    expect(new MediaConnectionError().code).toBe(53405);
  });

  it('ParticipantMaxTracksExceededError carries code 53203', () => {
    expect(new ParticipantMaxTracksExceededError().code).toBe(53203);
  });

  it('twilioErrorFromCode picks the matching subclass', () => {
    const err = twilioErrorFromCode(20101, 'bad token');
    expect(err).toBeInstanceOf(AccessTokenInvalidError);
    expect(err.message).toBe('bad token');
  });

  it('twilioErrorFromCode falls back to TwilioError for unknown codes', () => {
    const err = twilioErrorFromCode(99999, 'something');
    expect(err).toBeInstanceOf(TwilioError);
    expect(err.constructor.name).toBe('TwilioError');
    expect(err.code).toBe(99999);
  });

  it('twilioErrorFromCode maps non-integer codes to TwilioError with code 0', () => {
    const err = twilioErrorFromCode(NaN as unknown as number, 'bad');
    expect(err).toBeInstanceOf(TwilioError);
    expect(err.code).toBe(0);
    expect(err.message).toBe('bad');
  });

  it('TwilioError subclass keeps default message when given empty string', () => {
    const err = new RoomNotFoundError('');
    expect(err.message).toBe('Room not found');
  });
});

describe('createLocalTracks rejection', () => {
  it('rejects when an option is invalid (does not throw synchronously)', async () => {
    // Empty-string name fails validation in createLocalAudioTrack — must surface as a rejection
    await expect(createLocalTracks({ audio: { name: '' }, video: false })).rejects.toThrow(/name/i);
  });
});
