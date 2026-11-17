/**
 * Server-side Node.js SDK for Twilio Video Group Rooms with raw media frame
 * access.
 *
 * {@link connect} joins a Group Room and resolves with a {@link Room}. From
 * there, {@link Room.localParticipant} publishes tracks and
 * {@link Room.participants} exposes the remote participants whose tracks can be
 * subscribed to. Local tracks come from {@link createLocalVideoTrack},
 * {@link createLocalAudioTrack}, {@link createLocalDataTrack}, and
 * {@link createLocalTracks}.
 *
 * Video frames are I420 planar and audio is 48 kHz mono S16LE PCM, in both
 * directions. Timestamps are plain numbers of **microseconds**. Receive frames
 * with `for await (const frame of track.frames())`; awaiting each frame is what
 * applies backpressure. Call {@link Room.dispose} when finished to release
 * native resources.
 *
 *
 * @packageDocumentation
 */
import fs from 'node:fs';
import { Room } from './room.js';
import { MAX_QUEUE_CEILING } from './frame_stream.js';
import { H264LibraryLoadError, RoomConnectTimeoutError } from './errors.js';
import { addon, SDK_VERSION } from './native.js';
import type {
  NativeMediaFactory,
  ConnectOptions,
  EnableH264Options,
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
  RawVideoSourceOptions,
  RawAudioSourceOptions,
} from './types.js';

export { Room } from './room.js';
export type { RoomEvents } from './room.js';
export { LocalParticipant } from './local_participant.js';
export type { LocalParticipantEvents } from './local_participant.js';
export { RemoteParticipant } from './remote_participant.js';
export type { RemoteParticipantEvents } from './remote_participant.js';
export { TypedEventEmitter } from './typed_emitter.js';
export { RemoteVideoTrack, RemoteAudioTrack, RemoteDataTrack } from './remote_track.js';
export type { RemoteMediaTrackEvents, RemoteDataTrackEvents } from './remote_track.js';
export { MAX_QUEUE_CEILING } from './frame_stream.js';
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
  BackpressureMode,
  FrameDeliveryOptions,
  DeliveryStats,
  WriteStats,
  RawVideoSourceOptions,
  RawAudioSourceOptions,
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
  RoomState,
  ParticipantState,
  LogLevel,
  EnableH264Options,
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
  DataTrackSendResult,
} from './types.js';

export {
  TwilioError,
  SDK_LOCAL_CODE,
  // Access token
  AccessTokenInvalidError,
  AccessTokenHeaderInvalidError,
  AccessTokenIssuerInvalidError,
  AccessTokenExpiredError,
  AccessTokenNotYetValidError,
  AccessTokenGrantsInvalidError,
  AccessTokenSignatureInvalidError,
  // Signaling
  SignalingConnectionError,
  SignalingConnectionDisconnectedError,
  SignalingConnectionTimeoutError,
  // Room
  RoomConnectFailedError,
  RoomMaxParticipantsExceededError,
  RoomNotFoundError,
  RoomCompletedError,
  // Participant
  ParticipantMaxTracksExceededError,
  ParticipantDuplicateIdentityError,
  // Track
  TrackInvalidError,
  TrackNameInvalidError,
  TrackNameTooLongError,
  TrackNameCharsInvalidError,
  // Media
  MediaClientLocalDescFailedError,
  MediaServerLocalDescFailedError,
  MediaClientRemoteDescFailedError,
  MediaServerRemoteDescFailedError,
  MediaNoSupportedCodecError,
  MediaConnectionError,
  // SDK-local
  NativeBindingLoadError,
  UnsupportedPlatformError,
  RoomConnectTimeoutError,
  DataTrackSendError,
  H264LibraryLoadError,
  twilioErrorFromCode,
} from './errors.js';
export type { TwilioErrorClass } from './errors.js';

/**
 * Default {@link ConnectOptions.connectionTimeout}. Long enough to absorb a slow
 * signaling round trip and ICE gathering on a congested network, short enough
 * that a wedged connect surfaces rather than hanging a server process.
 */
const DEFAULT_CONNECTION_TIMEOUT_MS = 30_000;

/**
 * How long a timed-out connect waits for the native layer to report
 * `disconnected` before disposing anyway. Only a backstop against a disconnect
 * that never lands.
 */
const DISPOSE_GRACE_MS = 5_000;

/** Upper bound for a data track's `maxPacketLifeTime`/`maxRetransmits`; both are `unsigned short` in RTCDataChannelInit. */
const MAX_DATA_TRACK_LIMIT = 65535;
// VP8 stores frame width and height in 14 bits (RFC 6386 section 9.1).
const MAX_VIDEO_DIMENSION = 16383;

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
 * @throws {TypeError} (as a rejection) If `token` is not a non-empty string, or `options` is not an object.
 * @throws {TypeError} (as a rejection) If `options.preferredVideoCodecs` includes `H264` and
 *   {@link enableH264} hasn't succeeded.
 * @throws {RangeError} (as a rejection) If `options.networkQuality` verbosities are out of range.
 *
 * @example
 * const audioTrack = createLocalAudioTrack('mic');
 * const room = await connect(token, { name: 'my-room', audioTracks: [audioTrack] });
 */
export function connect(token: string, options: ConnectOptions = {}): Promise<Room> {
  if (!token || typeof token !== 'string') {
    return Promise.reject(new TypeError('token must be a non-empty string'));
  }
  if (typeof options !== 'object' || options === null) {
    return Promise.reject(new TypeError('options must be an object'));
  }
  const { networkQuality, connectionTimeout, ...rest } = options;
  if (connectionTimeout !== undefined) {
    if (!Number.isFinite(connectionTimeout) || connectionTimeout < 0) {
      return Promise.reject(
        new RangeError(
          `connectionTimeout must be a non-negative finite number of milliseconds; got ${String(connectionTimeout)}`,
        ),
      );
    }
  }
  const timeoutMs = connectionTimeout ?? DEFAULT_CONNECTION_TIMEOUT_MS;
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

  // Checked before the media factory exists, so this refusal doesn't stop a
  // later enableH264() from taking effect.
  if (
    !h264Enabled &&
    Array.isArray(options.preferredVideoCodecs) &&
    options.preferredVideoCodecs.includes('H264')
  ) {
    return Promise.reject(new TypeError('H264 requires enableH264() before connect()'));
  }
  internalOpts.mediaFactory = getDefaultMediaFactory();

  return new Promise((resolve, reject) => {
    const nativeRoom = addon.connect(token, internalOpts);
    const seededTracks = [
      ...(options.videoTracks ?? []),
      ...(options.audioTracks ?? []),
      ...(options.dataTracks ?? []),
    ];

    // A connect that neither succeeds nor fails would otherwise hang forever;
    // the native layer has no timeout of its own.
    //
    // `room` is declared with `let` and every reference is guarded, because the
    // Room constructor invokes its onConnected callback and could in principle
    // do so before the assignment completes. `settled` makes the three exits
    // (connected, failed, timed out) mutually exclusive.
    // It is assigned once, so prefer-const would flag it, but `const` here
    // would be a temporal-dead-zone hazard: the declaration has to precede
    // `new Room(...)` for the onConnected callback to close over it.
    // eslint-disable-next-line prefer-const
    let room: Room | undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    const clearTimer = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const onFailure = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimer();
      room?.dispose();
      reject(error || new Error('Connection failed'));
    };

    room = new Room(nativeRoom, seededTracks, () => {
      if (settled) return;
      settled = true;
      clearTimer();
      room?.removeListener('connectFailure', onFailure);
      resolve(room as Room);
    });

    room.once('connectFailure', onFailure);

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timer = null;
        if (settled) return;
        settled = true;
        const timedOutRoom = room;
        timedOutRoom?.removeListener('connectFailure', onFailure);

        // Reject now; unwind the native connect afterwards. Calling dispose()
        // straight away tears the Room down with the connect still in flight,
        // which leaves rtc-cpp's connect handler uncalled - it logs "The
        // connect handler was never called." Asking it to disconnect first
        // lets the attempt cancel through the normal path.
        reject(
          new RoomConnectTimeoutError(
            `Timed out after ${timeoutMs} ms connecting to the Room. ` +
              'Raise connectionTimeout, or pass 0 to wait indefinitely.',
          ),
        );

        if (!timedOutRoom) return;
        let disposed = false;
        const disposeOnce = () => {
          if (disposed) return;
          disposed = true;
          timedOutRoom.dispose();
        };
        timedOutRoom.once('disconnected', disposeOnce);
        try {
          timedOutRoom.disconnect();
        } catch {
          // Never connected far enough to disconnect; fall through to dispose.
        }
        // Backstop, so a disconnect that never lands cannot leak the Room.
        const grace = setTimeout(disposeOnce, DISPOSE_GRACE_MS);
        grace.unref?.();
      }, timeoutMs);
      // The native Room keeps the process alive while it connects; this
      // timeout shouldn't add a hold of its own.
      timer.unref?.();
    }
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
  const source = typeof options === 'object' && options !== null ? options.source : undefined;
  if (source !== undefined) validateVideoSource(source);
  const track = getDefaultMediaFactory().createVideoTrack(name ? { name } : {});
  if (source) {
    (track as unknown as { _configureSource(o: RawVideoSourceOptions): void })._configureSource(
      source,
    );
  }
  return track;
}

function validateVideoSource(source: RawVideoSourceOptions): void {
  if (typeof source !== 'object' || source === null) {
    throw new TypeError('source must be an object');
  }
  if (source.type !== 'raw') {
    throw new TypeError(`source.type must be 'raw'; got ${String(source.type)}`);
  }
  if (source.format !== 'I420') {
    throw new TypeError(`source.format must be 'I420'; got ${String(source.format)}`);
  }
  for (const key of ['width', 'height'] as const) {
    const v = source[key];
    if (!Number.isInteger(v) || v <= 0) {
      throw new RangeError(`source.${key} must be a positive integer; got ${String(v)}`);
    }
    if ((v as number) % 2 !== 0) {
      throw new RangeError(`source.${key} must be even; got ${String(v)}`);
    }
    if ((v as number) > MAX_VIDEO_DIMENSION) {
      throw new RangeError(
        `source.${key} must be at most ${MAX_VIDEO_DIMENSION}; got ${String(v)}`,
      );
    }
  }
  if (source.fps !== undefined && (!Number.isInteger(source.fps) || source.fps <= 0)) {
    throw new RangeError(`source.fps must be a positive integer; got ${String(source.fps)}`);
  }
}

function validateAudioSource(source: RawAudioSourceOptions): void {
  if (typeof source !== 'object' || source === null) {
    throw new TypeError('source must be an object');
  }
  if (source.type !== 'raw') {
    throw new TypeError(`source.type must be 'raw'; got ${String(source.type)}`);
  }
  if (source.format !== 'PCM_S16LE') {
    throw new TypeError(`source.format must be 'PCM_S16LE'; got ${String(source.format)}`);
  }
  // Fixed by the engine: WebRTC audio is 48 kHz internally and this SDK
  // publishes mono, so anything else would be silently wrong rather than
  // resampled.
  if (source.sampleRate !== 48000) {
    throw new RangeError(`source.sampleRate must be 48000; got ${String(source.sampleRate)}`);
  }
  if (source.channels !== 1) {
    throw new RangeError(`source.channels must be 1; got ${String(source.channels)}`);
  }
  if (source.maxQueue !== undefined) {
    if (!Number.isInteger(source.maxQueue) || source.maxQueue <= 0) {
      throw new RangeError(
        `source.maxQueue must be a positive integer; got ${String(source.maxQueue)}`,
      );
    }
    if (source.maxQueue > MAX_QUEUE_CEILING) {
      throw new RangeError(
        `source.maxQueue must be at most ${MAX_QUEUE_CEILING}; got ${source.maxQueue}`,
      );
    }
  }
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
  const source = typeof options === 'object' && options !== null ? options.source : undefined;
  if (source !== undefined) validateAudioSource(source);
  const track = getDefaultMediaFactory().createAudioTrack(name ? { name } : {});
  if (source) {
    (track as unknown as { _configureSource(o: RawAudioSourceOptions): void })._configureSource(
      source,
    );
  }
  return track;
}

/**
 * Create a {@link LocalDataTrack} for sending arbitrary string or binary
 * messages. The track defaults to reliable, ordered delivery; pass
 * `maxRetransmits` or `maxPacketLifeTime` to make it unreliable.
 *
 * @param options - A track name, or a {@link LocalDataTrackOptions} object.
 * @returns The created {@link LocalDataTrack}.
 * @throws {TypeError} If `options` is not a string or object, if `name` is not a non-empty string,
 * or if `ordered` is not a boolean.
 * @throws {Error} If both `maxRetransmits` and `maxPacketLifeTime` are set.
 * @throws {RangeError} If either `maxRetransmits` or `maxPacketLifeTime` is not an integer in [0, 65535].
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
  const name = resolveName(options, 'createLocalDataTrack');
  const opts: LocalDataTrackOptions = typeof options === 'string' ? {} : options;
  if (opts.ordered !== undefined && typeof opts.ordered !== 'boolean') {
    throw new TypeError('ordered must be a boolean');
  }
  if (opts.maxRetransmits != null && opts.maxPacketLifeTime != null) {
    throw new Error('maxRetransmits and maxPacketLifeTime are mutually exclusive');
  }
  for (const key of ['maxRetransmits', 'maxPacketLifeTime'] as const) {
    const value = opts[key];
    // Out-of-range values would be truncated silently by the native layer,
    // yielding a track with delivery guarantees the caller never asked for.
    if (value != null && (!Number.isInteger(value) || value < 0 || value > MAX_DATA_TRACK_LIMIT)) {
      throw new RangeError(
        `${key} must be an integer between 0 and ${MAX_DATA_TRACK_LIMIT}; got ${value}`,
      );
    }
  }
  return getDefaultMediaFactory().createDataTrack({ ...opts, name });
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
  /** The Access Token provided to the Twilio API was invalid. */
  ACCESS_TOKEN_INVALID: 20101,
  /** The Access Token's header is invalid. */
  ACCESS_TOKEN_HEADER_INVALID: 20102,
  /** The Access Token's issuer or subject is invalid. */
  ACCESS_TOKEN_ISSUER_INVALID: 20103,
  /** The Access Token has expired, or its expiration date is invalid. */
  ACCESS_TOKEN_EXPIRED: 20104,
  /** The Access Token's not-before time is in the future. */
  ACCESS_TOKEN_NOT_YET_VALID: 20105,
  /** The Access Token's grants were invalid, unparseable, or did not permit the requested operation. */
  ACCESS_TOKEN_GRANT_INVALID: 20106,
  /** The Access Token's signature did not verify. */
  ACCESS_TOKEN_SIGNATURE_INVALID: 20107,
  /** A signaling connection error not covered by a more specific code. */
  SIGNALING_CONNECTION_ERROR: 53000,
  /** The signaling connection was unexpectedly disconnected. */
  SIGNALING_CONNECTION_DISCONNECTED: 53001,
  /** The signaling connection timed out. */
  SIGNALING_CONNECTION_TIMEOUT: 53002,
  /** The operation was attempted on a Room that does not exist. */
  ROOM_NOT_FOUND: 53106,
  /** The Room could not be connected to, for a reason not covered by a more specific code. */
  ROOM_CONNECT_FAILED: 53104,
  /** The Room is already at its participant limit. */
  ROOM_MAX_PARTICIPANTS_EXCEEDED: 53105,
  /** The Room has been completed, and the requested operation cannot be performed on it. */
  ROOM_COMPLETED: 53118,
  /** The participant has reached its maximum number of published tracks. */
  PARTICIPANT_MAX_TRACKS_EXCEEDED: 53203,
  /** The participant was disconnected because another joined with the same identity. */
  PARTICIPANT_DUPLICATE_IDENTITY: 53205,
  /** The track is invalid, for a reason not covered by a more specific code. */
  TRACK_INVALID: 53300,
  /** The track name is invalid, for a reason not covered by a more specific code. */
  TRACK_NAME_INVALID: 53301,
  /** The track name exceeds the maximum length. */
  TRACK_NAME_TOO_LONG: 53302,
  /** The track's name contains characters that are not allowed. */
  TRACK_NAME_CHARS_INVALID: 53303,
  /** The client could not create or apply its local media description. */
  MEDIA_CLIENT_LOCAL_DESC_FAILED: 53400,
  /** The server could not create or apply its local media description. */
  MEDIA_SERVER_LOCAL_DESC_FAILED: 53401,
  /** The client could not apply the remote media description it received. */
  MEDIA_CLIENT_REMOTE_DESC_FAILED: 53402,
  /** The server could not apply the client's media description. */
  MEDIA_SERVER_REMOTE_DESC_FAILED: 53403,
  /** The client and server share no supported codec. */
  MEDIA_NO_SUPPORTED_CODEC: 53404,
  /** The media connection failed, or media activity ceased. */
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

const H264_PATENT_WARNING =
  'H.264 enabled via user-provided library. The developer is responsible for obtaining all applicable patent licenses.';

let h264Enabled = false;

/**
 * Load an OpenH264 2.7.x library so Rooms can negotiate H.264. Process-wide.
 *
 * Call it before the first {@link connect} or `createLocal*Track()` call: the
 * media factory those create reads the library once, so a later call throws.
 * Once enabled, H.264 is offered after VP8, and `preferredVideoCodecs` may
 * name `H264`. It stays enabled for the life of the process. Calling it again
 * before the first connect or track loads the given library instead.
 *
 * A frame larger than 1280x720 (3600 macroblocks) is scaled down to fit H.264
 * level 3.1, keeping its aspect ratio.
 *
 * Every successful call writes a patent-licensing notice with `console.warn`.
 *
 * @param options - The library path, and the required licensing confirmation.
 * @throws {TypeError} If `confirmPatentLicensingCompliance` isn't `true`, or
 *   `openh264Path` isn't a non-empty string without NUL characters. Nothing is loaded.
 * @throws {Error} If called after the first connect() or createLocal*Track().
 * @throws {H264LibraryLoadError} If the library can't be loaded or isn't OpenH264 2.7.x.
 */
export function enableH264(options: EnableH264Options): void {
  if (typeof options !== 'object' || options === null) {
    throw new TypeError('enableH264() options must be an object');
  }
  if (options.confirmPatentLicensingCompliance !== true) {
    throw new TypeError(
      'enableH264() requires confirmPatentLicensingCompliance: true. The developer is ' +
        'responsible for obtaining all applicable patent licenses.',
    );
  }
  const { openh264Path } = options;
  if (typeof openh264Path !== 'string' || openh264Path === '') {
    throw new TypeError('openh264Path must be a non-empty string');
  }
  // dlopen() would stop at the NUL and load whatever file the prefix names.
  if (openh264Path.includes('\0')) {
    throw new TypeError('openh264Path must not contain a NUL character');
  }
  if (defaultFactory) {
    throw new Error(
      'enableH264() must be called before the first connect() or createLocal*Track() call',
    );
  }
  try {
    addon.loadOpenH264(openh264Path);
  } catch (cause) {
    let message = (cause as Error).message;
    // glibc reports a library built for another architecture as missing. A
    // missing dependency reads the same, but dlerror() names the dependency.
    if (
      message.includes(`${openh264Path}: `) &&
      message.includes('No such file or directory') &&
      fs.existsSync(openh264Path)
    ) {
      message += '. The file exists, so it may be built for a different architecture or C library.';
    }
    throw new H264LibraryLoadError(message, { cause });
  }
  h264Enabled = true;
  console.warn(H264_PATENT_WARNING);
}

/** Whether an {@link enableH264} call has succeeded in this process. */
export function isH264Enabled(): boolean {
  return h264Enabled;
}
