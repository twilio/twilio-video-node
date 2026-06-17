import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Room } from './room.js';
import type {
  NativeAddon,
  NativeMediaFactory,
  ConnectOptions,
  CreateLocalVideoTrackOptions,
  CreateLocalAudioTrackOptions,
  CreateLocalTracksOptions,
  LocalVideoTrack,
  LocalAudioTrack,
  LocalDataTrack,
  LocalDataTrackOptions,
  LogLevel,
  PlatformInfo,
  NetworkQualityConfiguration,
} from './types.js';

export { Room } from './room.js';
export type { RoomEvents } from './room.js';
export { LocalParticipant } from './local_participant.js';
export type { LocalParticipantEvents } from './local_participant.js';
export { RemoteParticipant } from './remote_participant.js';
export type { RemoteParticipantEvents } from './remote_participant.js';
export { TypedEventEmitter } from './typed_emitter.js';
export {
  TrackPublication,
  LocalTrackPublication,
  LocalVideoTrackPublication,
  LocalAudioTrackPublication,
  LocalDataTrackPublication,
  RemoteTrackPublication,
  RemoteVideoTrackPublication,
  RemoteAudioTrackPublication,
  RemoteDataTrackPublication,
} from './track_publication.js';
export type { LocalTrack, RemoteTrack } from './track_publication.js';
export type { Track, Participant } from './types.js';
export type {
  ConnectOptions,
  IceOptions,
  IceServer,
  EncodingParameters,
  I420Plane,
  VideoFrameInput,
  VideoFrame,
  AudioFrameInput,
  AudioFrame,
  CreateLocalVideoTrackOptions,
  CreateLocalAudioTrackOptions,
  CreateLocalTracksOptions,
  TrackKind,
  LocalVideoTrack,
  LocalAudioTrack,
  LocalDataTrack,
  LocalDataTrackOptions,
  RemoteVideoTrack,
  RemoteAudioTrack,
  RemoteDataTrack,
  RoomState,
  ParticipantState,
  LogLevel,
  VideoTrackOptions,
  AudioTrackOptions,
  StatsReport,
  TrackStats,
  LocalTrackStats,
  RemoteTrackStats,
  LocalAudioTrackStats,
  LocalVideoTrackStats,
  RemoteAudioTrackStats,
  RemoteVideoTrackStats,
  StatsVideoDimensions,
  AudioCodec,
  VideoCodec,
  VideoEncodingMode,
  BandwidthProfileMode,
  TrackSwitchOffMode,
  ClientTrackSwitchOffControl,
  VideoContentPreferencesMode,
  VideoBandwidthProfileOptions,
  BandwidthProfileOptions,
  NetworkQualityVerbosity,
  NetworkQualityConfiguration,
  VideoRenderDimensions,
  VideoContentPreferences,
  RemoteTrackPublishEvent,
  RemoteTrackStateEvent,
} from './types.js';

export {
  TwilioError,
  AccessTokenInvalidError,
  RoomNotFoundError,
  SignalingConnectionError,
  MediaConnectionError,
  ParticipantMaxTracksExceededError,
  twilioErrorFromCode,
} from './errors.js';

// --- Addon loading ---

const __filename_ = fileURLToPath(import.meta.url);
const __dirname_ = path.dirname(__filename_);
const nativeRequire = createRequire(import.meta.url);

// Resolve the project root (works from both lib/ and dist/)
const ROOT = fs.existsSync(path.join(__dirname_, '..', 'package.json'))
  ? path.join(__dirname_, '..')
  : path.join(__dirname_, '..', '..');

const { version: SDK_VERSION } = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'),
);

function getPlatformDir(): string {
  return `${process.platform}-${process.arch}`;
}

function getPrebuiltPath(platformDir: string): string {
  const addonName = 'twilio_video_sdk_node';
  return path.join(ROOT, 'prebuilds', platformDir, `${addonName}-${platformDir}.node`);
}

function loadAddon(): NativeAddon {
  const platformDir = getPlatformDir();
  const prebuiltPath = getPrebuiltPath(platformDir);

  if (fs.existsSync(prebuiltPath)) {
    return nativeRequire(prebuiltPath);
  }

  try {
    return nativeRequire(path.join(ROOT, 'build/Release/twilio_video_sdk_node.node'));
  } catch {
    try {
      return nativeRequire(path.join(ROOT, 'build/Debug/twilio_video_sdk_node.node'));
    } catch (cause) {
      throw new Error(
        `No prebuilt binary found for ${platformDir}. ` +
          'Run npm run build to compile from source.',
        { cause },
      );
    }
  }
}

const addon = loadAddon();

// --- Default MediaFactory ---

let defaultFactory: NativeMediaFactory | null = null;
function getDefaultMediaFactory(): NativeMediaFactory {
  if (!defaultFactory) {
    defaultFactory = new addon.MediaFactory();
  }
  return defaultFactory;
}

// --- Public API ---

/**
 * Connect to a Twilio Group Room. The returned promise resolves once the Room
 * emits `connected`, and rejects with a {@link TwilioError} if it emits
 * `connectFailure` first (the partially-built Room is disposed on failure).
 *
 * @param token - A Twilio access token with a Video grant.
 * @param options - Room name, tracks to publish on join, and feature toggles.
 * @returns A promise resolving to the connected {@link Room}.
 * @throws {TypeError} (as a rejection) If `token` is not a non-empty string.
 * @throws {RangeError} (as a rejection) If `options.networkQuality` verbosities are out of range.
 *
 * @example
 * const room = await connect(token, { name: 'my-room', audio: true });
 */
export function connect(token: string, options: ConnectOptions = {}): Promise<Room> {
  if (!token || typeof token !== 'string') {
    return Promise.reject(new TypeError('token must be a non-empty string'));
  }
  const { networkQuality, ...rest } = options;
  const internalOpts: Record<string, unknown> = { ...rest };
  // networkQuality is the public contract; clear the native-only fields before re-deriving them,
  // so a caller passing them directly cannot override us.
  delete internalOpts.enableNetworkQuality;
  delete internalOpts.networkQualityConfiguration;

  if (networkQuality === true) {
    internalOpts.enableNetworkQuality = true;
    internalOpts.networkQualityConfiguration = { local: 1, remote: 0 };
  } else if (networkQuality && typeof networkQuality === 'object') {
    let normalized: { local: number; remote: number };
    try {
      normalized = normalizeNetworkQualityConfig(networkQuality);
    } catch (err) {
      return Promise.reject(err as Error);
    }
    internalOpts.enableNetworkQuality = true;
    internalOpts.networkQualityConfiguration = normalized;
  } else {
    internalOpts.enableNetworkQuality = false;
  }

  // Pre-populate platformInfo so C++ just reads it
  const platformInfo: PlatformInfo = {
    sdkVersion: SDK_VERSION,
    platformName: 'nodejs',
    platformVersion: process.version.replace(/^v/, ''),
    deviceArchitecture: process.arch,
  };
  internalOpts.platformInfo = platformInfo;

  internalOpts.mediaFactory = getDefaultMediaFactory();

  return new Promise((resolve, reject) => {
    const nativeRoom = addon.connect(token, internalOpts);
    const seededTracks = [
      ...(options.videoTracks ?? []),
      ...(options.audioTracks ?? []),
      ...(options.dataTracks ?? []),
    ];
    const room = new Room(nativeRoom, seededTracks);

    const onConnected = () => {
      room.removeListener('connectFailure', onFailure);
      resolve(room);
    };
    const onFailure = (error: unknown) => {
      room.removeListener('connected', onConnected);
      room.dispose();
      reject(error || new Error('Connection failed'));
    };

    room.once('connected', onConnected);
    room.once('connectFailure', onFailure);
  });
}

function resolveName(options: unknown, methodName: string): string | undefined {
  if (options === undefined) return undefined;
  if (typeof options === 'string') {
    if (options.length === 0) {
      throw new TypeError('name must be a non-empty string');
    }
    return options;
  }
  if (typeof options !== 'object' || options === null) {
    throw new TypeError(`${methodName} expects a string or options object`);
  }
  const name = (options as { name?: unknown }).name;
  if (name === undefined) return undefined;
  if (typeof name !== 'string' || name.length === 0) {
    throw new TypeError('name must be a non-empty string');
  }
  return name;
}

function normalizeNetworkQualityConfig(config: NetworkQualityConfiguration): {
  local: number;
  remote: number;
} {
  const local = config.local ?? 1;
  const remote = config.remote ?? 0;
  if (local !== 1) {
    throw new RangeError(
      `networkQuality.local must be 1; to disable network-quality reporting, pass \`networkQuality: false\`. Got ${local}`,
    );
  }
  if (!Number.isInteger(remote) || remote < 0 || remote > 1) {
    throw new RangeError(
      `networkQuality.remote must be 0 (disabled) or 1 (enabled); got ${remote}`,
    );
  }
  return { local, remote };
}

/**
 * Create a {@link LocalVideoTrack}. The track is a sink for caller-supplied
 * frames, delivered via {@link LocalVideoTrack.write}. Frames pushed before
 * the room emits `connected` are silently dropped.
 *
 * @param options - A track name, or a {@link CreateLocalVideoTrackOptions} object.
 * @returns The created {@link LocalVideoTrack}.
 * @throws {TypeError} If `options.name` is provided and is not a non-empty string.
 *
 * @example
 * // Create a track and connect with it.
 * const videoTrack = createLocalVideoTrack('camera');
 * const room = await connect(token, { videoTracks: [videoTrack] });
 *
 * @example
 * // Add video to an already-connected room.
 * const videoTrack = createLocalVideoTrack({ name: 'camera' });
 * room.localParticipant.publishTrack(videoTrack);
 */
export function createLocalVideoTrack(
  options?: string | CreateLocalVideoTrackOptions,
): LocalVideoTrack {
  const name = resolveName(options, 'createLocalVideoTrack');
  return getDefaultMediaFactory().createVideoTrack(name ? { name } : {});
}

/**
 * Create a {@link LocalAudioTrack}. The track is a sink for caller-supplied
 * PCM samples, delivered via {@link LocalAudioTrack.write}. Audio input is
 * fixed at **48 kHz mono S16LE**.
 *
 * @param options - A track name, or a {@link CreateLocalAudioTrackOptions} object.
 * @returns The created {@link LocalAudioTrack}.
 * @throws {TypeError} If `options.name` is provided and is not a non-empty string.
 *
 * @example
 * // Create a track and connect with it.
 * const audioTrack = createLocalAudioTrack('microphone');
 * const room = await connect(token, { audioTracks: [audioTrack] });
 *
 * @example
 * // Add audio to an already-connected room.
 * const audioTrack = createLocalAudioTrack({ name: 'microphone' });
 * room.localParticipant.publishTrack(audioTrack);
 */
export function createLocalAudioTrack(
  options?: string | CreateLocalAudioTrackOptions,
): LocalAudioTrack {
  const name = resolveName(options, 'createLocalAudioTrack');
  return getDefaultMediaFactory().createAudioTrack(name ? { name } : {});
}

/**
 * Create a {@link LocalDataTrack} for sending arbitrary string or binary
 * messages. The track defaults to reliable, ordered delivery; pass
 * `maxRetransmits` or `maxPacketLifeTime` to make it unreliable.
 *
 * @param options - A track name, or a {@link LocalDataTrackOptions} object.
 * @returns The created {@link LocalDataTrack}.
 * @throws {TypeError} If `options` is not a string or object, or if `name` is not a non-empty string.
 * @throws {Error} If both `maxRetransmits` and `maxPacketLifeTime` are set, or if either is negative.
 *
 * @example
 * // Reliable, ordered messaging.
 * const dataTrack = createLocalDataTrack('chat');
 * room.localParticipant.publishTrack(dataTrack);
 * dataTrack.send('hello');
 *
 * @example
 * // Unreliable, time-bounded delivery.
 * const dataTrack = createLocalDataTrack({ name: 'telemetry', maxPacketLifeTime: 1000 });
 */
export function createLocalDataTrack(options: LocalDataTrackOptions | string = {}): LocalDataTrack {
  if (typeof options !== 'string' && (typeof options !== 'object' || options === null)) {
    throw new TypeError('createLocalDataTrack expects a string or options object');
  }
  const opts: LocalDataTrackOptions = typeof options === 'string' ? { name: options } : options;
  if (opts.name !== undefined && (typeof opts.name !== 'string' || opts.name.length === 0)) {
    throw new TypeError('name must be a non-empty string');
  }
  if (opts.maxRetransmits != null && opts.maxPacketLifeTime != null) {
    throw new Error('maxRetransmits and maxPacketLifeTime are mutually exclusive');
  }
  if (
    (opts.maxRetransmits != null && opts.maxRetransmits < 0) ||
    (opts.maxPacketLifeTime != null && opts.maxPacketLifeTime < 0)
  ) {
    throw new Error('maxRetransmits and maxPacketLifeTime must be non-negative');
  }
  return getDefaultMediaFactory().createDataTrack(opts);
}

/**
 * Create {@link LocalAudioTrack}s and {@link LocalVideoTrack}s. By default,
 * returns both a {@link LocalAudioTrack} and a {@link LocalVideoTrack}. If
 * either `audio` or `video` is provided, the unspecified kind is omitted.
 * Each key accepts a boolean or a per-track options object.
 *
 * @param options - Track selection and per-track configuration.
 * @returns A promise that resolves with the created local tracks, or rejects
 *   with a `TypeError` if a per-track option fails validation.
 *
 * @example
 * // Create both audio and video tracks.
 * const tracks = await createLocalTracks();
 *
 * @example
 * // Create only an audio track and connect with it.
 * const tracks = await createLocalTracks({ audio: true });
 * const room = await connect(token, { audioTracks: tracks });
 *
 * @example
 * // Create both with custom names.
 * const tracks = await createLocalTracks({
 *   audio: { name: 'microphone' },
 *   video: { name: 'camera' },
 * });
 */
export async function createLocalTracks(
  options: CreateLocalTracksOptions = {},
): Promise<(LocalAudioTrack | LocalVideoTrack)[]> {
  // Specifying either key opts the other out; both default ON only when neither is set.
  const defaultEnabled = !('audio' in options) && !('video' in options);
  const audio = options.audio ?? defaultEnabled;
  const video = options.video ?? defaultEnabled;
  const tracks: (LocalAudioTrack | LocalVideoTrack)[] = [];
  if (audio) {
    tracks.push(createLocalAudioTrack(typeof audio === 'object' ? audio : undefined));
  }
  if (video) {
    tracks.push(createLocalVideoTrack(typeof video === 'object' ? video : undefined));
  }
  return tracks;
}

/**
 * Known Twilio error codes, mapping a descriptive name to its numeric code.
 * Match against {@link TwilioError.code} to identify a failure without
 * depending on the error message.
 */
export const ErrorCode = Object.freeze({
  ACCESS_TOKEN_INVALID: 20101,
  ACCESS_TOKEN_HEADER_INVALID: 20102,
  ACCESS_TOKEN_ISSUER_INVALID: 20103,
  ACCESS_TOKEN_EXPIRED: 20104,
  ACCESS_TOKEN_NOT_YET_VALID: 20105,
  ACCESS_TOKEN_GRANT_INVALID: 20106,
  ACCESS_TOKEN_SIGNATURE_INVALID: 20107,
  SIGNALING_CONNECTION_ERROR: 53000,
  SIGNALING_CONNECTION_DISCONNECTED: 53001,
  SIGNALING_CONNECTION_TIMEOUT: 53002,
  ROOM_NOT_FOUND: 53106,
  ROOM_CONNECT_FAILED: 53104,
  ROOM_MAX_PARTICIPANTS_EXCEEDED: 53105,
  ROOM_COMPLETED: 53118,
  PARTICIPANT_DUPLICATE_IDENTITY: 53205,
  TRACK_INVALID: 53300,
  TRACK_NAME_TOO_LONG: 53301,
  TRACK_NAME_CHARS_INVALID: 53303,
  MEDIA_CLIENT_LOCAL_DESC_FAILED: 53400,
  MEDIA_SERVER_LOCAL_DESC_FAILED: 53401,
  MEDIA_CLIENT_REMOTE_DESC_FAILED: 53402,
  MEDIA_SERVER_REMOTE_DESC_FAILED: 53403,
  MEDIA_NO_SUPPORTED_CODEC: 53404,
  MEDIA_CONNECTION_ERROR: 53405,
} as const);

/** The version of the underlying native rtc-cpp engine (distinct from this package's version). */
export function getVersion(): string {
  return addon.getVersion();
}

/**
 * Set the verbosity of the native SDK's logging. Process-global and effective
 * immediately for all current and future Rooms.
 *
 * @param level - A {@link LogLevel} name or its equivalent native numeric level.
 */
export function setLogLevel(level: LogLevel | number): void {
  addon.setLogLevel(level);
}
