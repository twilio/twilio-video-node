// SID/identity type aliases that document intent at call sites
// (e.g. `Map<Track.SID, ...>`). These are plain strings, not branded types.
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Track {
  /** A Track SID (`MT...`), unique per published track. */
  export type SID = string;
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Participant {
  /** A Participant SID (`PA...`), unique per participant in a room. */
  export type SID = string;
  /** A Participant's application-defined identity string. */
  export type Identity = string;
}

/** A single plane (Y, U, or V) of a decoded I420 video frame. `stride` is the byte width of each row, which may exceed `width`. */
export interface I420Plane {
  data: Buffer;
  stride: number;
  width: number;
  height: number;
}

/**
 * An I420 video frame to push into a {@link LocalVideoTrack} via its `write`
 * method. The `y` buffer must be at least `yStride * height` bytes; the `u`/`v`
 * buffers at least `uStride * (height / 2)` / `vStride * (height / 2)` bytes
 * (chroma is 2x-subsampled in each dimension). `width` and `height` must be
 * positive and even; odd dimensions are rejected with a `RangeError`.
 */
export interface VideoFrameInput {
  width: number;
  height: number;
  y: Buffer;
  u: Buffer;
  v: Buffer;
  yStride: number;
  uStride: number;
  vStride: number;
  /** Defaults to the current monotonic time when omitted. */
  timestampNs?: bigint;
  rotation?: 0 | 90 | 180 | 270;
}

/** A decoded I420 video frame delivered to a {@link RemoteVideoTrack}'s frame callback. `frameId` increments per frame. */
export interface VideoFrame {
  format: 'I420';
  width: number;
  height: number;
  y: I420Plane;
  u: I420Plane;
  v: I420Plane;
  timestampNs: bigint;
  captureTimestampNs?: bigint;
  rtpTimestamp?: number;
  frameId: number;
  rotation?: 0 | 90 | 180 | 270;
}

/** A PCM audio frame to push into a {@link LocalAudioTrack} via its `write` method. `pcm` is int16 mono samples at 48 kHz; `frames` is the sample count. */
export interface AudioFrameInput {
  pcm: Buffer;
  frames: number;
}

/** A PCM audio frame delivered to a {@link RemoteAudioTrack}'s frame callback. Always `PCM_S16LE`; `frameId` increments per frame. */
export interface AudioFrame {
  format: 'PCM_S16LE';
  sampleRate: number;
  channels: number;
  frames: number;
  pcm: Buffer;
  timestampNs: bigint;
  frameId: number;
}

/** Options for {@link createLocalVideoTrack}. */
export interface CreateLocalVideoTrackOptions {
  name?: string;
}

/** Options for {@link createLocalAudioTrack}. */
export interface CreateLocalAudioTrackOptions {
  name?: string;
}

/** Options for {@link createLocalTracks}. Each key accepts a boolean to toggle the kind, or a per-track options object. */
export interface CreateLocalTracksOptions {
  audio?: boolean | CreateLocalAudioTrackOptions;
  video?: boolean | CreateLocalVideoTrackOptions;
}

// `TwilioError` itself is exported from `./errors.js` as a class. Internal
// modules that only need its shape import it from there as a type.

/** Native media-factory options for creating a video track. */
export interface VideoTrackOptions {
  name?: string;
}

/** Native media-factory options for creating an audio track. */
export interface AudioTrackOptions {
  name?: string;
}

/** Internal — auto-detected by the SDK, not user-facing. */
export interface PlatformInfo {
  sdkVersion: string;
  platformName: string;
  platformVersion: string;
  deviceArchitecture: string;
}

/** A custom ICE (STUN/TURN) server. `username`/`credential` are required for TURN. */
export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

/** ICE transport configuration for {@link ConnectOptions}. `transportPolicy: 'relay'` forces all traffic through TURN. */
export interface IceOptions {
  transportPolicy?: 'all' | 'relay';
  iceServers?: IceServer[];
}

/** Maximum send bitrates, in bits per second. Omitted fields leave the corresponding limit unchanged. */
export interface EncodingParameters {
  maxAudioBitrate?: number;
  maxVideoBitrate?: number;
}

/** Audio codecs that may be negotiated, in preference order. */
export type AudioCodec = 'opus' | 'PCMA' | 'PCMU' | 'G722';
/** Video codecs that may be negotiated, in preference order. */
export type VideoCodec = 'H264' | 'VP8' | 'VP9';

/** Video encoding strategy. Currently only `auto` (server-driven) is supported. */
export type VideoEncodingMode = 'auto';

/** Bandwidth-profile layout hint describing how remote video is arranged on screen. */
export type BandwidthProfileMode = 'collaboration' | 'grid' | 'presentation';
/** How the SDK switches off remote video tracks under bandwidth pressure. */
export type TrackSwitchOffMode = 'detected' | 'predicted' | 'disabled';
/** Whether track switch-off is driven automatically or controlled manually by the app. */
export type ClientTrackSwitchOffControl = 'auto' | 'manual';
/** Whether render-dimension content preferences are derived automatically or set manually. */
export type VideoContentPreferencesMode = 'auto' | 'manual';

/** Video portion of a {@link BandwidthProfileOptions}, controlling subscription bandwidth and switch-off behavior. */
export interface VideoBandwidthProfileOptions {
  mode?: BandwidthProfileMode;
  maxSubscriptionBitrate?: number;
  trackSwitchOffMode?: TrackSwitchOffMode;
  clientTrackSwitchOffControl?: ClientTrackSwitchOffControl;
  contentPreferencesMode?: VideoContentPreferencesMode;
}

/** Bandwidth-profile options passed to {@link connect} to manage subscriber-side bandwidth. */
export interface BandwidthProfileOptions {
  video?: VideoBandwidthProfileOptions;
}

/**
 * Network-quality reporting verbosity. `0` disables, `1` enables minimal
 * reporting.
 */
export type NetworkQualityVerbosity = 0 | 1;

/** Per-side network-quality reporting verbosities, passed via {@link ConnectOptions.networkQuality}. */
export interface NetworkQualityConfiguration {
  /** Local participant verbosity. Only `1` is valid; to disable reporting, pass `networkQuality: false`. */
  local?: 1;
  remote?: NetworkQualityVerbosity;
}

/** Options for {@link connect}. All fields are optional; omitted feature toggles fall back to Room/server defaults. */
export interface ConnectOptions {
  /** Room name to connect to. When omitted, the Room SID is used as its name. */
  name?: string;
  /** Local video tracks to publish on join. */
  videoTracks?: LocalVideoTrack[];
  /** Local audio tracks to publish on join. */
  audioTracks?: LocalAudioTrack[];
  /** Local data tracks to publish on join. */
  dataTracks?: LocalDataTrack[];
  /** Enable Twilio Insights telemetry for this Room. */
  enableInsights?: boolean;
  /** Automatically subscribe to remote participants' tracks. When `false`, tracks must be subscribed to explicitly. */
  enableAutomaticSubscription?: boolean;
  /** Enable dominant-speaker detection, which powers {@link Room.dominantSpeaker} and the `dominantSpeakerChanged` event. */
  enableDominantSpeaker?: boolean;
  /**
   * Enable network-quality reporting. Pass `true` for default verbosity
   * (`local=1`, `remote=0`) or an object to set verbosities individually.
   * Setting `false` (or omitting) disables reporting.
   */
  networkQuality?: boolean | NetworkQualityConfiguration;
  /** Preferred audio codecs in descending priority. */
  preferredAudioCodecs?: AudioCodec[];
  /** Preferred video codecs in descending priority. */
  preferredVideoCodecs?: VideoCodec[];
  videoEncodingMode?: VideoEncodingMode;
  bandwidthProfile?: BandwidthProfileOptions;
  /** Subscribe to live transcriptions, delivered via the Room's `transcription` event. */
  receiveTranscriptions?: boolean;
  /** Signaling region to connect through (e.g. `us1`, `gll` for lowest-latency). */
  region?: string;
  iceOptions?: IceOptions;
  /** Initial send-bitrate limits; equivalent to calling {@link LocalParticipant.setEncodingParameters} after connect. */
  encodingParameters?: EncodingParameters;
}

/** The kind of media a track carries. */
export type TrackKind = 'video' | 'audio' | 'data';

/** A local video track that the application feeds with I420 frames. Create via {@link createLocalVideoTrack}. */
export interface LocalVideoTrack {
  readonly name: string;
  readonly kind: 'video';
  /** Whether the track is enabled; setting `false` publishes black/silent media without unpublishing. */
  enabled: boolean;
  /**
   * Push an I420 frame into the track.
   *
   * Throws `TypeError`/`RangeError` on invalid input (bad shape, non-finite
   * integers, non-BigInt timestamp, invalid rotation, plane buffer smaller than
   * `stride * height`). Throws `Error` if the track is not bound to a source.
   *
   * Returns `true` when the frame was forwarded to the encoder sink. Returns
   * `false` when the underlying adapter dropped the frame — most commonly
   * because the encoder sink has not yet attached (frames pushed before the
   * room emits `connected`), but also when the adapter rate-limits or rejects
   * the frame's resolution.
   */
  write(frame: VideoFrameInput): boolean;
}

/** A local audio track that the application feeds with PCM samples. Create via {@link createLocalAudioTrack}. */
export interface LocalAudioTrack {
  readonly name: string;
  readonly kind: 'audio';
  /** Whether the track is enabled; setting `false` publishes silence without unpublishing. */
  enabled: boolean;
  /**
   * Push a PCM audio frame into the track.
   *
   * Format is fixed at **48 kHz mono S16LE** — `AudioFrameInput` exposes no
   * sampleRate/channels fields, and `pcm` is interpreted as int16 mono samples.
   *
   * Throws `TypeError`/`RangeError` on invalid input (missing/non-Buffer `pcm`,
   * non-integer `frames`, `pcm` shorter than `frames`). Throws `Error` if the
   * track is not bound to a source. Returns `true` on successful enqueue.
   */
  write(frame: AudioFrameInput): boolean;
  /** Drop any buffered, not-yet-sent audio samples. Use to discard stale audio before resuming. */
  clearBuffer(): void;
}

/**
 * Options for {@link createLocalDataTrack}. `maxPacketLifeTime` and
 * `maxRetransmits` are mutually exclusive; setting either makes delivery
 * unreliable. Defaults are reliable, ordered delivery.
 */
export interface LocalDataTrackOptions {
  name?: string;
  /** Max time (ms) to attempt retransmitting a message before dropping it. Mutually exclusive with `maxRetransmits`. */
  maxPacketLifeTime?: number | null;
  /** Max number of retransmit attempts per message. Mutually exclusive with `maxPacketLifeTime`. */
  maxRetransmits?: number | null;
  /** Whether messages are delivered in order. Defaults to `true`. */
  ordered?: boolean;
}

/** A local data track for sending string or binary messages. Create via {@link createLocalDataTrack}. */
export interface LocalDataTrack {
  readonly name: string;
  readonly kind: 'data';
  /**
   * The maximum period of time in milliseconds in which retransmissions will be
   * sent, as passed to {@link createLocalDataTrack}, or `null` when unset.
   */
  readonly maxPacketLifeTime: number | null;
  /**
   * The maximum number of times a message is retransmitted before being given
   * up on, as passed to {@link createLocalDataTrack}, or `null` when unset.
   */
  readonly maxRetransmits: number | null;
  /** Whether delivery is reliable (neither retransmit limit set). */
  readonly reliable: boolean;
  readonly ordered: boolean;
  /** Send a message to all subscribed remote participants. */
  send(data: string | Buffer): void;
}

/** Desired render dimensions for a remote video track, used to right-size the publisher's encoding. */
export interface VideoRenderDimensions {
  width: number;
  height: number;
}

/** Per-track content preferences for a {@link RemoteVideoTrack}, applied via `setContentPreferences`. */
export interface VideoContentPreferences {
  renderDimensions?: VideoRenderDimensions;
}

/**
 * A remote participant's video track. Attach a frame callback via `onFrame` to
 * receive decoded {@link VideoFrame}s; only one callback is active at a time.
 */
export interface RemoteVideoTrack {
  readonly name: string;
  readonly kind: 'video';
  readonly sid: Track.SID;
  readonly enabled: boolean;
  /** Whether the SDK has switched this track off (no frames delivered) under bandwidth pressure. Tracks the `videoTrackSwitchedOff`/`videoTrackSwitchedOn` events. */
  readonly isSwitchedOff: boolean;
  /** Register the frame callback, replacing any previous one. */
  onFrame(callback: (frame: VideoFrame) => void): void;
  /** Remove the frame callback so frames stop being delivered. Pair with `onFrame` to release the listener. */
  removeFrameCallback(): void;
  setContentPreferences(preferences: VideoContentPreferences): void;
}

/**
 * A remote participant's audio track. Attach a frame callback via `onFrame` to
 * receive decoded {@link AudioFrame}s; only one callback is active at a time.
 */
export interface RemoteAudioTrack {
  readonly name: string;
  readonly kind: 'audio';
  readonly sid: Track.SID;
  readonly enabled: boolean;
  /** Register the frame callback, replacing any previous one. */
  onFrame(callback: (frame: AudioFrame) => void): void;
  /** Remove the frame callback so frames stop being delivered. Pair with `onFrame` to release the listener. */
  removeFrameCallback(): void;
}

/**
 * A remote participant's data track. Attach a message callback via `onMessage`
 * to receive sent messages; only one callback is active at a time.
 */
export interface RemoteDataTrack {
  readonly name: string;
  readonly kind: 'data';
  readonly sid: Track.SID;
  /**
   * The maximum period of time in milliseconds in which the publisher
   * retransmits messages, or `null` when they left it unset. A publisher's
   * `65535` also reads back as `null`, because the subscribed track reports it
   * the same way it reports an unset limit; use `reliable` to tell the two
   * apart.
   */
  readonly maxPacketLifeTime: number | null;
  /**
   * The maximum number of times the publisher retransmits a message before
   * giving up, or `null` when unset. `65535` reads back as `null`, as for
   * {@link RemoteDataTrack.maxPacketLifeTime}.
   */
  readonly maxRetransmits: number | null;
  /** Whether delivery is reliable (the publisher set neither retransmit limit). */
  readonly reliable: boolean;
  readonly ordered: boolean;
  /** Register the message callback, replacing any previous one. */
  onMessage(callback: (data: string | Buffer) => void): void;
  /** Remove the message callback so messages stop being delivered. Pair with `onMessage` to release the listener. */
  removeMessageCallback(): void;
}

/** Raw native shape of a track publication. The exported `TrackPublication` class wraps this. */
export interface TrackPublication {
  trackSid: Track.SID;
  trackName: string;
  kind: TrackKind;
  isTrackEnabled: boolean;
}

/** Raw native shape of a remote track publication, adding subscription state and the subscribed track. */
export interface RemoteTrackPublication extends TrackPublication {
  isSubscribed: boolean;
  track?: RemoteVideoTrack | RemoteAudioTrack | RemoteDataTrack;
}

/** Payload for the `trackPublished`/`trackUnpublished` events. */
export interface RemoteTrackPublishEvent {
  trackSid: Track.SID;
  trackName: string;
}

/** Payload for the `trackEnabled`/`trackDisabled` events. */
export interface RemoteTrackStateEvent extends RemoteTrackPublishEvent {
  isSubscribed: boolean;
}

/** Width/height in pixels reported in track stats. */
export interface StatsVideoDimensions {
  width: number;
  height: number;
}

/** Stats common to every track. `timestamp` is in milliseconds since the Unix epoch; `trackSid` is the Track SID (`MT...`). */
export interface TrackStats {
  codec: string;
  packetsLost: number;
  ssrc: string;
  timestamp: number;
  trackSid: Track.SID;
}

/** Send-side stats for a local track. `roundTripTime` is in seconds. */
export interface LocalTrackStats extends TrackStats {
  bytesSent: number;
  packetsSent: number;
  roundTripTime: number;
}

/** Receive-side stats for a remote track. */
export interface RemoteTrackStats extends TrackStats {
  bytesReceived: number;
  packetsReceived: number;
}

/** Send-side audio stats. `audioLevel` is the linear input level; `jitter` is in milliseconds. */
export interface LocalAudioTrackStats extends LocalTrackStats {
  audioLevel: number;
  jitter: number;
}

/** Send-side video stats. `captureDimensions`/`captureFrameRate` describe input, `dimensions`/`frameRate` describe what is encoded. */
export interface LocalVideoTrackStats extends LocalTrackStats {
  captureDimensions: StatsVideoDimensions;
  dimensions: StatsVideoDimensions;
  captureFrameRate: number;
  frameRate: number;
  framesEncoded: number;
}

/** Receive-side audio stats. `audioLevel` is the linear output level; `jitter` is in milliseconds. */
export interface RemoteAudioTrackStats extends RemoteTrackStats {
  audioLevel: number;
  jitter: number;
}

/** Receive-side video stats describing the decoded stream. */
export interface RemoteVideoTrackStats extends RemoteTrackStats {
  dimensions: StatsVideoDimensions;
  frameRate: number;
}

/** A stats snapshot for one peer connection, returned by {@link Room.getStats}. */
export interface StatsReport {
  peerConnectionId: string;
  localAudioTrackStats: LocalAudioTrackStats[];
  localVideoTrackStats: LocalVideoTrackStats[];
  remoteAudioTrackStats: RemoteAudioTrackStats[];
  remoteVideoTrackStats: RemoteVideoTrackStats[];
}

/** A {@link Room}'s connection state. */
export type RoomState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

/** Native SDK log verbosity, from `off` (silent) to `all` (most verbose). Set via {@link setLogLevel}. */
export type LogLevel = 'off' | 'fatal' | 'error' | 'warning' | 'info' | 'debug' | 'trace' | 'all';

// Internal: the shape of the native C++ addon
export interface NativeAddon {
  getVersion(): string;
  setLogLevel(level: LogLevel | number): void;
  connect(token: string, options: Record<string, unknown>): NativeRoom;
  MediaFactory: new () => NativeMediaFactory;
}

export interface NativeMediaFactory {
  createVideoTrack(options: VideoTrackOptions): LocalVideoTrack;
  createAudioTrack(options: AudioTrackOptions): LocalAudioTrack;
  createDataTrack(options: LocalDataTrackOptions): LocalDataTrack;
}

export interface NativeRoom {
  readonly name: string;
  readonly sid: string;
  readonly state: string;
  readonly mediaRegion: string;
  readonly isRecording: boolean;
  readonly localParticipant: NativeLocalParticipant;
  readonly dominantSpeaker: NativeRemoteParticipant | null;
  readonly remoteParticipants: NativeRemoteParticipant[];
  disconnect(): void;
  dispose(): void;
  setEventCallback(cb: (event: string, data?: unknown) => void): void;
  getStats(callback: (error: Error | null, reports: StatsReport[]) => void): void;
}

/** A participant's connection state within a {@link Room}. */
export type ParticipantState = 'connected' | 'reconnecting' | 'disconnected';

export interface NativeLocalParticipant {
  readonly identity: string;
  readonly sid: string;
  readonly state: string;
  readonly networkQualityLevel: number | null;
  readonly signalingRegion: string;
  readonly videoTracks: TrackPublication[];
  readonly audioTracks: TrackPublication[];
  readonly dataTracks: TrackPublication[];
  publishTrack(track: LocalVideoTrack | LocalAudioTrack | LocalDataTrack): boolean;
  unpublishTrack(track: LocalVideoTrack | LocalAudioTrack | LocalDataTrack): boolean;
  setEncodingParameters(params?: EncodingParameters): void;
  setEventCallback(cb: (event: string, data?: unknown) => void): void;
}

export interface NativeRemoteParticipant {
  readonly identity: string;
  readonly sid: string;
  readonly state: string;
  readonly networkQualityLevel: number | null;
  readonly videoTracks: RemoteTrackPublication[];
  readonly audioTracks: RemoteTrackPublication[];
  readonly dataTracks: RemoteTrackPublication[];
  setEventCallback(cb: (event: string, data?: unknown) => void): void;
}
