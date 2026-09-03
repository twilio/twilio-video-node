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
  LocalVideoTrackPublication,
  Room,
} from '../lib/index.js';
import type { ConnectOptions, BandwidthProfileMode } from '../lib/index.js';

// Internal imports for testing non-exported utilities and error classes
import {
  liftTwilioError,
  TwilioError as TwilioErrorSrc,
  RoomNotFoundError as RoomNotFoundErrorSrc,
} from '../lib/errors.js';
import type {
  NativeRoom,
  NativeRemoteParticipant,
  RemoteTrackPublication,
  RemoteTrackSubscriptionFailedEvent,
} from '../lib/types.js';
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

  it('setLogLevel accepts numeric levels 0 through 7', () => {
    for (let n = 0; n <= 7; n++) {
      expect(() => setLogLevel(n)).not.toThrow();
    }
  });

  it('setLogLevel rejects out-of-range numeric levels', () => {
    expect(() => setLogLevel(8)).toThrow(/Invalid log level/);
    expect(() => setLogLevel(-1)).toThrow(/Invalid log level/);
    expect(() => setLogLevel(1.5)).toThrow(/Invalid log level/);
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

  it('rejects a non-string name option', async () => {
    // @ts-expect-error testing runtime validation
    await expect(connect('token', { name: 123 })).rejects.toThrow(/name must be a string/);
  });

  it('rejects a non-boolean feature toggle', async () => {
    // @ts-expect-error testing runtime validation
    await expect(connect('token', { enableDominantSpeaker: 'yes' })).rejects.toThrow(
      /enableDominantSpeaker must be a boolean/,
    );
  });

  it('rejects a present-but-non-string videoEncodingMode', async () => {
    // @ts-expect-error testing runtime validation
    await expect(connect('token', { videoEncodingMode: 42 })).rejects.toThrow(
      /videoEncodingMode must be a string/,
    );
  });

  it('rejects a non-object options argument', async () => {
    // @ts-expect-error testing runtime validation
    await expect(connect('token', 42)).rejects.toThrow(/options must be an object/);
  });

  it('rejects a null options argument', async () => {
    // @ts-expect-error testing runtime validation
    await expect(connect('token', null)).rejects.toThrow(/options must be an object/);
  });

  it('rejects a present-but-non-string bandwidthProfile.video.mode', async () => {
    await expect(
      // @ts-expect-error testing runtime validation
      connect('token', { bandwidthProfile: { video: { mode: 1 } } }),
    ).rejects.toThrow(/bandwidthProfile.video.mode must be a string/);
  });

  it('rejects a non-array track option', async () => {
    const track = createLocalVideoTrack('arr-test');
    // @ts-expect-error testing runtime validation: videoTracks must be an array
    await expect(connect('token', { videoTracks: track })).rejects.toThrow(
      /videoTracks must be an array/,
    );
  });

  it('rejects a non-array preferredVideoCodecs option', async () => {
    // @ts-expect-error testing runtime validation
    await expect(connect('token', { preferredVideoCodecs: 'VP8' })).rejects.toThrow(
      /preferredVideoCodecs must be an array/,
    );
  });

  it('rejects H264 in preferredVideoCodecs', async () => {
    // @ts-expect-error testing runtime validation: H264 is not a supported VideoCodec
    await expect(connect('token', { preferredVideoCodecs: ['H264'] })).rejects.toThrow(
      /Unknown video codec: H264/,
    );
  });

  it('rejects VP9 in preferredVideoCodecs', async () => {
    // @ts-expect-error testing runtime validation: VP9 is not a supported VideoCodec
    await expect(connect('token', { preferredVideoCodecs: ['VP9'] })).rejects.toThrow(
      /Unknown video codec: VP9/,
    );
  });

  it('rejects PCMA in preferredAudioCodecs', async () => {
    // @ts-expect-error testing runtime validation: PCMA is not a supported AudioCodec
    await expect(connect('token', { preferredAudioCodecs: ['PCMA'] })).rejects.toThrow(
      /Unknown audio codec: PCMA/,
    );
  });

  it('rejects G722 in preferredAudioCodecs', async () => {
    // @ts-expect-error testing runtime validation: G722 is not a supported AudioCodec
    await expect(connect('token', { preferredAudioCodecs: ['G722'] })).rejects.toThrow(
      /Unknown audio codec: G722/,
    );
  });

  it('rejects a non-object iceOptions option', async () => {
    // @ts-expect-error testing runtime validation
    await expect(connect('token', { iceOptions: 'relay' })).rejects.toThrow(
      /iceOptions must be an object/,
    );
  });

  it('rejects an unknown iceOptions.transportPolicy', async () => {
    await expect(
      // @ts-expect-error testing runtime validation
      connect('token', { iceOptions: { transportPolicy: 'nope' } }),
    ).rejects.toThrow(/Unknown iceOptions.transportPolicy/);
  });

  it('rejects an out-of-range bandwidthProfile.video.maxSubscriptionBitrate', async () => {
    await expect(
      connect('token', { bandwidthProfile: { video: { maxSubscriptionBitrate: -1 } } }),
    ).rejects.toThrow(/maxSubscriptionBitrate/);
  });

  it('rejects when native option access throws', async () => {
    const options: ConnectOptions = {
      bandwidthProfile: {
        video: {
          get mode(): BandwidthProfileMode {
            throw new Error('expected error from mode getter');
          },
        },
      },
    };
    await expect(connect('token', options)).rejects.toThrow(/expected error from mode getter/);
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

    const result = track.write({ ...generateI420Frame(320, 240), timestamp: 1_000_000 });
    expect(result).toBe(false);
  });

  it('write defaults the timestamp when omitted', () => {
    const track = createLocalVideoTrack('default-ts');
    expect(track.write(generateI420Frame(320, 240))).toBe(false);
  });

  it('write accepts a padded stride', () => {
    const track = createLocalVideoTrack('padded-stride');
    expect(track.write(generateI420Frame(320, 240, 16))).toBe(false);
  });

  it('write rejects odd width or height', () => {
    const track = createLocalVideoTrack('odd-dims-test');
    const base = generateI420Frame(320, 240);
    expect(() => track.write({ ...base, width: 321 })).toThrow(/must be even/);
    expect(() => track.write({ ...base, height: 241 })).toThrow(/must be even/);
  });

  it('write rejects a non-I420 format', () => {
    const track = createLocalVideoTrack('bad-format');
    const base = generateI420Frame(320, 240);
    expect(() => track.write({ ...base, format: 'NV12' as never })).toThrow(/must be 'I420'/);
  });

  it('write rejects a plane that is not an I420Plane object', () => {
    const track = createLocalVideoTrack('bad-plane');
    const base = generateI420Frame(320, 240);
    // A Buffer is an object, so it reaches the plane-shape check and fails on
    // the missing `data` member rather than on the object check.
    expect(() => track.write({ ...base, y: Buffer.alloc(10) as never })).toThrow(
      /y\.data must be a Buffer/,
    );
    // A primitive fails the object check itself.
    expect(() => track.write({ ...base, v: 5 as never })).toThrow(/must be an I420Plane object/);
    // An explicitly-undefined key is still present, so it fails the object
    // check; only a wholly absent plane reports as missing.
    expect(() => track.write({ ...base, u: undefined as never })).toThrow(
      /u must be an I420Plane object/,
    );
    const missing = { ...base } as Partial<typeof base>;
    delete missing.u;
    expect(() => track.write(missing as typeof base)).toThrow(/requires an I420Plane/);
  });

  it('write rejects a plane buffer shorter than stride * height', () => {
    const track = createLocalVideoTrack('short-plane');
    const base = generateI420Frame(320, 240);
    const short = { ...base, y: { ...base.y, data: Buffer.alloc(100) } };
    expect(() => track.write(short)).toThrow(/smaller than stride/);
  });

  it('write rejects a stride narrower than the plane width', () => {
    const track = createLocalVideoTrack('narrow-stride');
    const base = generateI420Frame(320, 240);
    expect(() => track.write({ ...base, y: { ...base.y, stride: 16 } })).toThrow(
      /strides must be >=/,
    );
  });

  it('write rejects a non-numeric or negative timestamp', () => {
    const track = createLocalVideoTrack('bad-ts');
    const base = generateI420Frame(320, 240);
    expect(() => track.write({ ...base, timestamp: 1n as never })).toThrow(/must be a number/);
    expect(() => track.write({ ...base, timestamp: -1 })).toThrow(/non-negative/);
    expect(() => track.write({ ...base, timestamp: 1.5 })).toThrow(/whole number/);
  });

  it('write rejects an invalid rotation', () => {
    const track = createLocalVideoTrack('bad-rotation');
    const base = generateI420Frame(320, 240);
    expect(() => track.write({ ...base, rotation: 45 as never })).toThrow(/0, 90, 180, or 270/);
  });

  it('getWriteStats counts dropped frames and reports no send queue', () => {
    const track = createLocalVideoTrack('write-stats');
    expect(track.getWriteStats()).toMatchObject({
      framesWritten: 0,
      framesDropped: 0,
      sendQueueDepth: 0,
      maxQueue: 0,
    });

    // Unpublished, so every frame is rejected by the adapter and counted.
    track.write(generateI420Frame(320, 240));
    track.write(generateI420Frame(320, 240));

    const stats = track.getWriteStats();
    expect(stats.framesDropped).toBe(2);
    expect(stats.framesWritten).toBe(0);
    // Video publish is synchronous, so nothing is ever queued SDK-side.
    expect(stats.sendQueueDepth).toBe(0);
  });

  it('counts timestamp regressions without rejecting the frame', () => {
    const track = createLocalVideoTrack('ts-regression');
    expect(track.getWriteStats().timestampRegressions).toBe(0);

    // Unpublished frames are dropped by the adapter, so drive the counter
    // through the audio path instead, which accepts writes immediately.
    const audio = createLocalAudioTrack('ts-regression-audio');
    const pcm = generateAudioSamples(480, 48000, 1);
    audio.write({ pcm, frames: 480, timestamp: 2_000_000 });
    audio.write({ pcm, frames: 480, timestamp: 3_000_000 });
    expect(audio.getWriteStats().timestampRegressions).toBe(0);

    // Going backwards is accepted - a looping file source does this - but is
    // counted so it stays visible.
    audio.write({ pcm, frames: 480, timestamp: 1_000_000 });
    expect(audio.getWriteStats().timestampRegressions).toBe(1);
    // A repeated timestamp does not advance either.
    audio.write({ pcm, frames: 480, timestamp: 1_000_000 });
    expect(audio.getWriteStats().timestampRegressions).toBe(2);
    expect(audio.getWriteStats().framesWritten).toBe(4);
  });

  it('source options constrain the accepted frame size', () => {
    const track = createLocalVideoTrack({
      name: 'sized-source',
      source: { type: 'raw', format: 'I420', width: 320, height: 240, fps: 30 },
    });
    // Matching dimensions pass validation and reach the adapter.
    expect(track.write(generateI420Frame(320, 240))).toBe(false);
    // A different size is rejected rather than silently rescaled.
    expect(() => track.write(generateI420Frame(640, 480))).toThrow(
      /do not match the track's configured source size/,
    );
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
  it('creates a named data track with expected defaults', () => {
    const track = createLocalDataTrack('my-channel');
    expect(track.name).toBe('my-channel');
    expect(track.ordered).toBe(true);
    expect(track.reliable).toBe(true);
    expect(track.maxRetransmits).toBeNull();
    expect(track.maxPacketLifeTime).toBeNull();
  });

  it('creates a data track with defaults when called with no arguments', () => {
    const track = createLocalDataTrack();
    expect(track.name).toBeDefined();
    expect(track.ordered).toBe(true);
    expect(track.reliable).toBe(true);
    expect(track.maxRetransmits).toBeNull();
    expect(track.maxPacketLifeTime).toBeNull();
  });

  it('accepts maxRetransmits option', () => {
    const track = createLocalDataTrack({ name: 'retransmit-track', maxRetransmits: 3 });
    expect(track.name).toBe('retransmit-track');
    expect(track.maxRetransmits).toBe(3);
    expect(track.maxPacketLifeTime).toBeNull();
    expect(track.reliable).toBe(false);
    expect(track.ordered).toBe(true);
  });

  it('accepts maxPacketLifeTime option', () => {
    const track = createLocalDataTrack({ name: 'lifetime-track', maxPacketLifeTime: 1000 });
    expect(track.name).toBe('lifetime-track');
    expect(track.maxPacketLifeTime).toBe(1000);
    expect(track.maxRetransmits).toBeNull();
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

  // Every out-of-range value must be rejected loudly: the native layer reads these
  // with Int32Value(), which turns NaN into 0 and truncates fractions, silently
  // producing an unreliable track the caller never asked for.
  const rejectedLimits = [-1, 65536, 70000, 1.5, NaN, Infinity, -Infinity];
  const rejectedCases = (['maxRetransmits', 'maxPacketLifeTime'] as const).flatMap(key =>
    rejectedLimits.map(value => ({ key, value })),
  );

  it.each(rejectedCases)('throws on $key: $value', ({ key, value }) => {
    const create = () => createLocalDataTrack({ [key]: value });
    expect(create).toThrow(RangeError);
    expect(create).toThrow(new RegExp(`^${key} must be an integer between 0 and 65535`));
  });

  it('throws on a non-boolean ordered', () => {
    expect(() => createLocalDataTrack({ ordered: 0 as unknown as boolean })).toThrow(TypeError);
  });

  it('treats explicitly undefined options as unset', () => {
    const track = createLocalDataTrack({
      name: 'spread-track',
      maxRetransmits: undefined,
      maxPacketLifeTime: undefined,
      ordered: undefined,
    });
    expect(track.name).toBe('spread-track');
    expect(track.maxRetransmits).toBeNull();
    expect(track.maxPacketLifeTime).toBeNull();
    expect(track.ordered).toBe(true);
    expect(track.reliable).toBe(true);
  });

  it('accepts a value read off a track as an option', () => {
    const source = createLocalDataTrack({ name: 'source', maxRetransmits: 3 });
    const clone = createLocalDataTrack({
      name: 'clone',
      maxRetransmits: source.maxRetransmits,
      maxPacketLifeTime: source.maxPacketLifeTime,
    });
    expect(clone.maxRetransmits).toBe(3);
    expect(clone.maxPacketLifeTime).toBeNull();
  });

  it('accepts 0 as a distinct value from unset', () => {
    const track = createLocalDataTrack({ name: 'zero-retransmits', maxRetransmits: 0 });
    expect(track.maxRetransmits).toBe(0);
    expect(track.reliable).toBe(false);
  });

  it('reports the maximum maxPacketLifeTime rather than collapsing it to unset', () => {
    const track = createLocalDataTrack({ name: 'max-lifetime', maxPacketLifeTime: 65535 });
    expect(track.maxPacketLifeTime).toBe(65535);
    expect(track.maxRetransmits).toBeNull();
    expect(track.reliable).toBe(false);
  });

  it('send does not throw on disconnected track', () => {
    const track = createLocalDataTrack('send-test');
    expect(track.name).toBe('send-test');
    expect(() => track.send('hello')).not.toThrow();
    expect(() => track.send(Buffer.from([0xde, 0xad]))).not.toThrow();
  });
});

describe('Track source option validation', () => {
  const videoSource = { type: 'raw', format: 'I420', width: 320, height: 240 } as const;
  const audioSource = {
    type: 'raw',
    format: 'PCM_S16LE',
    sampleRate: 48000,
    channels: 1,
  } as const;

  it('accepts a well-formed video source', () => {
    expect(() =>
      createLocalVideoTrack({ name: 'v-ok', source: { ...videoSource, fps: 30 } }),
    ).not.toThrow();
  });

  it('rejects a non-object video source', () => {
    expect(() => createLocalVideoTrack({ name: 'v1', source: null as never })).toThrow(TypeError);
    expect(() => createLocalVideoTrack({ name: 'v2', source: 5 as never })).toThrow(TypeError);
  });

  it('rejects a video source with the wrong type or format', () => {
    expect(() =>
      createLocalVideoTrack({ name: 'v3', source: { ...videoSource, type: 'file' as never } }),
    ).toThrow(/type must be 'raw'/);
    expect(() =>
      createLocalVideoTrack({ name: 'v4', source: { ...videoSource, format: 'NV12' as never } }),
    ).toThrow(/format must be 'I420'/);
  });

  it.each(['width', 'height'] as const)('rejects a non-positive-integer %s', key => {
    for (const bad of [0, -2, 1.5, '320']) {
      expect(() =>
        createLocalVideoTrack({ name: `v-${key}-${bad}`, source: { ...videoSource, [key]: bad } }),
      ).toThrow(RangeError);
    }
  });

  it.each(['width', 'height'] as const)('rejects an odd %s', key => {
    expect(() =>
      createLocalVideoTrack({ name: `v-odd-${key}`, source: { ...videoSource, [key]: 321 } }),
    ).toThrow(/must be even/);
  });

  it('rejects a non-positive-integer fps', () => {
    for (const bad of [0, -1, 1.5]) {
      expect(() =>
        createLocalVideoTrack({ name: `v-fps-${bad}`, source: { ...videoSource, fps: bad } }),
      ).toThrow(/fps must be a positive integer/);
    }
  });

  it('accepts a well-formed audio source', () => {
    expect(() =>
      createLocalAudioTrack({
        name: 'a-ok',
        source: { ...audioSource, mode: 'queue', maxQueue: 20, drop: 'oldest' },
      }),
    ).not.toThrow();
  });

  it('rejects a non-object audio source', () => {
    expect(() => createLocalAudioTrack({ name: 'a1', source: null as never })).toThrow(TypeError);
  });

  it('rejects an audio source with the wrong type or format', () => {
    expect(() =>
      createLocalAudioTrack({ name: 'a2', source: { ...audioSource, type: 'file' as never } }),
    ).toThrow(/type must be 'raw'/);
    expect(() =>
      createLocalAudioTrack({ name: 'a3', source: { ...audioSource, format: 'F32' as never } }),
    ).toThrow(/format must be 'PCM_S16LE'/);
  });

  it('rejects any sample rate or channel count but 48000 mono', () => {
    // Fixed by the engine: anything else would be silently wrong, not resampled.
    expect(() =>
      createLocalAudioTrack({ name: 'a4', source: { ...audioSource, sampleRate: 16000 as never } }),
    ).toThrow(/sampleRate must be 48000/);
    expect(() =>
      createLocalAudioTrack({ name: 'a5', source: { ...audioSource, channels: 2 as never } }),
    ).toThrow(/channels must be 1/);
  });

  it('rejects an invalid audio mode or drop policy', () => {
    expect(() =>
      createLocalAudioTrack({ name: 'a6', source: { ...audioSource, mode: 'fastest' as never } }),
    ).toThrow(/mode must be/);
    expect(() =>
      createLocalAudioTrack({ name: 'a7', source: { ...audioSource, drop: 'middle' as never } }),
    ).toThrow(/drop must be/);
  });

  it('rejects an out-of-range audio maxQueue', () => {
    for (const bad of [0, -1, 2.5]) {
      expect(() =>
        createLocalAudioTrack({ name: `a-mq-${bad}`, source: { ...audioSource, maxQueue: bad } }),
      ).toThrow(/maxQueue must be a positive integer/);
    }
    expect(() =>
      createLocalAudioTrack({ name: 'a-mq-big', source: { ...audioSource, maxQueue: 100000 } }),
    ).toThrow(/must be at most/);
  });

  it('sheds a burst that exceeds the audio publish queue, and says so', () => {
    // Documents a real tradeoff rather than asserting it is fine. The audio
    // default of 10 chunks is ~100ms, so a producer that emits a
    // whole utterance at once - a common TTS integration - loses most of it
    // unless it paces its writes or raises maxQueue.
    const track = createLocalAudioTrack({
      name: 'burst-default',
      source: { ...audioSource, maxQueue: 10 },
    });
    const pcm = generateAudioSamples(480, 48000, 1);

    let accepted = 0;
    for (let i = 0; i < 50; i++) {
      if (track.write({ pcm, frames: 480 })) accepted++;
    }

    // Only the queue's worth is taken; the rest is shed and counted.
    expect(accepted).toBeLessThan(50);
    expect(track.getWriteStats().framesDropped).toBeGreaterThan(0);
    expect(accepted + track.getWriteStats().framesDropped).toBe(50);
  });

  it('accepts the same burst when the queue is sized for it', () => {
    const track = createLocalAudioTrack({
      name: 'burst-sized',
      source: { ...audioSource, maxQueue: 100 },
    });
    const pcm = generateAudioSamples(480, 48000, 1);

    let accepted = 0;
    for (let i = 0; i < 50; i++) {
      if (track.write({ pcm, frames: 480 })) accepted++;
    }
    expect(accepted).toBe(50);
    expect(track.getWriteStats().framesDropped).toBe(0);
  });

  it('applies the configured audio maxQueue to the publish queue', () => {
    const track = createLocalAudioTrack({
      name: 'a-configured',
      source: { ...audioSource, maxQueue: 25 },
    });
    expect(track.getWriteStats().maxQueue).toBe(25);
  });
});

describe('connect() connectionTimeout validation', () => {
  it.each([-1, NaN, Infinity, 'soon'])('rejects %s', async bad => {
    await expect(connect('token', { connectionTimeout: bad as never })).rejects.toThrow(RangeError);
  });

  it('rejects a non-string, non-object argument to the track factories', () => {
    expect(() => createLocalVideoTrack(5 as never)).toThrow(
      /createLocalVideoTrack expects a string or options object/,
    );
    expect(() => createLocalAudioTrack(true as never)).toThrow(
      /createLocalAudioTrack expects a string or options object/,
    );
  });

  it('normalizes a networkQuality object before reaching the native layer', async () => {
    // Valid config: gets past validation and fails later on the bogus token,
    // rather than being rejected as out of range.
    await expect(
      connect('not-a-real-token', { networkQuality: { local: 1, remote: 1 } }),
    ).rejects.not.toThrow(RangeError);
  });

  it('accepts 0, meaning wait indefinitely', async () => {
    // Reaches the native connect (and fails there on the fake token) rather
    // than being rejected by validation.
    await expect(connect('not-a-real-token', { connectionTimeout: 0 })).rejects.not.toThrow(
      RangeError,
    );
  });
});

describe('Data Track send limits', () => {
  it('rejects a string message over 64 KB synchronously', () => {
    const track = createLocalDataTrack('too-big-string');
    const oversize = 'a'.repeat(64 * 1024 + 1);
    expect(() => track.send(oversize)).toThrow(RangeError);
    expect(() => track.send(oversize)).toThrow(/exceeds the 65536-byte maximum/);
  });

  it('rejects a Buffer message over 64 KB synchronously', () => {
    const track = createLocalDataTrack('too-big-buffer');
    expect(() => track.send(Buffer.alloc(64 * 1024 + 1))).toThrow(RangeError);
  });

  it('accepts a message exactly at the 64 KB limit', () => {
    const track = createLocalDataTrack('at-limit');
    expect(() => track.send(Buffer.alloc(64 * 1024))).not.toThrow();
  });

  it('counts UTF-8 bytes, not characters, for the limit', () => {
    const track = createLocalDataTrack('utf8-limit');
    // Each of these is 4 UTF-8 bytes, so 16385 of them is just over 64 KB
    // while being far fewer than 65536 JS characters.
    expect(() => track.send('\u{1F600}'.repeat(16385))).toThrow(RangeError);
  });

  it('returns a promise from send()', () => {
    const track = createLocalDataTrack('promise-shape');
    const result = track.send('hello');
    expect(result).toBeInstanceOf(Promise);
    // Never rejects, so a fire-and-forget send cannot cause an unhandled
    // rejection. Unpublished, the result simply never settles, so this only
    // asserts the shape.
    result.catch(() => expect.unreachable('send() must not reject'));
  });

  it('rejects a non-string, non-Buffer payload', () => {
    const track = createLocalDataTrack('bad-payload');
    expect(() => track.send(42 as never)).toThrow(TypeError);
  });
});

describe('createLocalTracks', () => {
  it('returns audio and video when no options are provided', async () => {
    const tracks = await createLocalTracks();
    const kinds = tracks.map(t => t.kind).sort();
    expect(kinds).toEqual(['audio', 'video']);
  });

  it('returns only audio when only audio is specified', async () => {
    const tracks = await createLocalTracks({ audio: true });
    expect(tracks).toHaveLength(1);
    expect(tracks[0].kind).toBe('audio');
  });

  it('returns only video when only video is specified', async () => {
    const tracks = await createLocalTracks({ video: true });
    expect(tracks).toHaveLength(1);
    expect(tracks[0].kind).toBe('video');
  });

  it('returns an empty array when both audio and video are false', async () => {
    const tracks = await createLocalTracks({ audio: false, video: false });
    expect(tracks).toHaveLength(0);
  });

  it('forwards per-track names when both kinds are requested', async () => {
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

describe('connect() encodingParameters validation', () => {
  it('rejects a non-number bitrate', async () => {
    await expect(
      // @ts-expect-error testing runtime validation
      connect('fake-token', { encodingParameters: { maxAudioBitrate: 'fast' } }),
    ).rejects.toThrow(/encodingParameters\.maxAudioBitrate/);
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

  it('MediaConnectionError carries code 53405 and canonical message', () => {
    const err = new MediaConnectionError();
    expect(err.code).toBe(53405);
    expect(err.message).toBe('Media connection failed or Media activity ceased');
  });

  it('ParticipantMaxTracksExceededError carries code 53203 and canonical message', () => {
    const err = new ParticipantMaxTracksExceededError();
    expect(err.code).toBe(53203);
    expect(err.message).toBe(
      'The maximum number of published tracks allowed in the Room at the same time has been reached',
    );
  });

  it('twilioErrorFromCode picks the matching subclass and uses its canonical message', () => {
    // Parity with twilio-video.js: a known code ignores the caller message.
    const err = twilioErrorFromCode(20101, 'bad token');
    expect(err).toBeInstanceOf(AccessTokenInvalidError);
    expect(err.message).toBe('Invalid Access Token');
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

describe('liftTwilioError', () => {
  it('passes an existing TwilioError through unchanged', () => {
    const original = new RoomNotFoundErrorSrc();
    expect(liftTwilioError(original)).toBe(original);
  });

  it('lifts a { code, message } payload into the matching subclass', () => {
    const err = liftTwilioError({ code: 53106, message: 'gone' });
    expect(err).toBeInstanceOf(RoomNotFoundErrorSrc);
    expect(err.code).toBe(53106);
  });

  it('preserves a string payload as the message', () => {
    const err = liftTwilioError('boom');
    expect(err).toBeInstanceOf(TwilioErrorSrc);
    expect(err.code).toBe(0);
    expect(err.message).toBe('boom');
  });

  it('preserves the message of an arbitrary object payload instead of discarding it', () => {
    const err = liftTwilioError({ message: 'native detail' });
    expect(err.code).toBe(0);
    expect(err.message).toBe('native detail');
  });
});

describe('LocalTrackPublication.unpublish()', () => {
  // Minimal raw publication shape the constructor reads.
  const raw = { trackSid: 'MT123', trackName: 'cam', kind: 'video', isTrackEnabled: true } as const;

  it('invokes the injected unpublish callback with the track and returns the publication', () => {
    const track = { name: 'cam', kind: 'video' } as never;
    let calledWith: unknown = null;
    const pub = new LocalVideoTrackPublication(raw, track, (t: unknown) => {
      calledWith = t;
      return true;
    });
    const result = pub.unpublish();
    expect(calledWith).toBe(track);
    expect(result).toBe(pub);
    expect(pub.track).toBe(track); // track stays readable, matching twilio-video.js
  });

  it('is idempotent: a second call does not invoke the callback again', () => {
    const track = { name: 'cam', kind: 'video' } as never;
    let calls = 0;
    const pub = new LocalVideoTrackPublication(raw, track, () => {
      calls += 1;
      return true;
    });
    pub.unpublish();
    pub.unpublish();
    expect(calls).toBe(1);
  });

  it('is a no-op when constructed without an unpublish callback', () => {
    const track = { name: 'cam', kind: 'video' } as never;
    const pub = new LocalVideoTrackPublication(raw, track);
    expect(() => pub.unpublish()).not.toThrow();
    expect(pub.unpublish()).toBe(pub);
  });
});

describe('Participants already in the Room at connect', () => {
  type NativeCallback = (event: string, data?: unknown) => void;
  // `emit` stands in for the native side raising an event on the wrap.
  type FakeParticipant = NativeRemoteParticipant & { emit: NativeCallback };

  function subscribedPublication(kind: 'video' | 'audio') {
    return {
      trackSid: `MT-${kind}`,
      trackName: `${kind}-track`,
      kind,
      isTrackEnabled: true,
      isSubscribed: true,
      track: { kind, sid: `MT-${kind}` } as never,
    };
  }

  function makeNativeParticipant(
    videoTracks: RemoteTrackPublication[] = [],
    audioTracks: RemoteTrackPublication[] = [],
  ): FakeParticipant {
    const participant = {
      sid: 'PA1',
      identity: 'alice',
      state: 'connected',
      networkQualityLevel: null,
      videoTracks,
      audioTracks,
      dataTracks: [],
      setEventCallback(cb: NativeCallback) {
        participant.emit = cb;
      },
    } as unknown as FakeParticipant;
    return participant;
  }

  // The native 'connected' event is what seeds the participants, so it has to fire
  // before the Room is handed back, exactly as connect() does.
  function connectFake(participants: FakeParticipant[]): Room {
    let emit!: NativeCallback;
    const nativeRoom = {
      remoteParticipants: participants,
      setEventCallback(cb: NativeCallback) {
        emit = cb;
      },
    } as unknown as NativeRoom;
    const room = new Room(nativeRoom);
    emit('connected');
    return room;
  }

  it('exposes the tracks a participant had already subscribed to as Room state', () => {
    const alice = makeNativeParticipant(
      [subscribedPublication('video')],
      [subscribedPublication('audio')],
    );

    const room = connectFake([alice]);

    // Tracks subscribed before connect() resolved are visible here with isSubscribed true.
    const [participant] = [...room.participants.values()];
    const subscribed = [...participant.tracks.values()].filter(pub => pub.isSubscribed);
    expect(subscribed.map(pub => pub.track?.kind)).toEqual(['video', 'audio']);
  });

  it('emits track events that arrive after connect for a participant who was already present', () => {
    const alice = makeNativeParticipant();
    const room = connectFake([alice]);
    const seen: string[] = [];
    room.on('trackSubscribed', (track, participant) =>
      seen.push(`${participant.identity}:${track.kind}`),
    );

    alice.emit('trackSubscribed', { kind: 'video' });
    expect(seen).toEqual(['alice:video']);
  });

  const nativeSubscriptionFailure = {
    error: { code: 53106, message: 'gone' },
    publication: { trackSid: 'MT-video', trackName: 'cam', kind: 'video' },
  };

  it('bubbles trackSubscriptionFailed with the publication and the participant appended', () => {
    const alice = makeNativeParticipant();
    const room = connectFake([alice]);
    const seen: [TwilioErrorSrc, RemoteTrackSubscriptionFailedEvent, string][] = [];
    room.on('trackSubscriptionFailed', (error, publication, participant) =>
      seen.push([error, publication, participant.identity]),
    );

    alice.emit('trackSubscriptionFailed', nativeSubscriptionFailure);
    expect(seen).toHaveLength(1);
    const [error, publication, identity] = seen[0];
    expect(error.code).toBe(53106);
    expect(identity).toBe('alice');
    expect(publication.trackSid).toBe('MT-video');
    expect(publication.kind).toBe('video');
  });

  it('reports the failing publication on the participant', () => {
    const alice = makeNativeParticipant();
    const room = connectFake([alice]);
    const [participant] = [...room.participants.values()];
    const seen: [number, string][] = [];
    participant.on('trackSubscriptionFailed', (error, publication) =>
      seen.push([error.code, publication.trackSid]),
    );

    alice.emit('trackSubscriptionFailed', nativeSubscriptionFailure);
    expect(seen).toEqual([[53106, 'MT-video']]);
  });
});
