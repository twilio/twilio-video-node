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
  /** The plane's samples, `stride * height` bytes long. */
  data: Buffer;
  /** Bytes per row, at least `width` and possibly padded for alignment. */
  stride: number;
  /** Plane width in samples. Half the frame width for the U and V planes. */
  width: number;
  /** Plane height in samples. Half the frame height for the U and V planes. */
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
  /** Frame width in pixels. */
  width: number;
  /** Frame height in pixels. */
  height: number;
  /** Luminance plane, `yStride * height` bytes long. */
  y: Buffer;
  /** Blue-difference chrominance plane, `uStride * ceil(height / 2)` bytes long. */
  u: Buffer;
  /** Red-difference chrominance plane, `vStride * ceil(height / 2)` bytes long. */
  v: Buffer;
  /** Bytes per row in {@link VideoFrameInput.y}, at least `width`. */
  yStride: number;
  /** Bytes per row in {@link VideoFrameInput.u}, at least `ceil(width / 2)`. */
  uStride: number;
  /** Bytes per row in {@link VideoFrameInput.v}, at least `ceil(width / 2)`. */
  vStride: number;
  /** Defaults to the current monotonic time when omitted. */
  timestampNs?: bigint;
  /** Clockwise rotation to apply on display, in degrees. Defaults to `0`. */
  rotation?: 0 | 90 | 180 | 270;
}

/** A decoded I420 video frame delivered to a {@link RemoteVideoTrack}'s frame callback. `frameId` increments per frame. */
export interface VideoFrame {
  /** Always `'I420'`. The only pixel format this SDK delivers. */
  format: 'I420';
  /** Frame width in pixels. */
  width: number;
  /** Frame height in pixels. */
  height: number;
  /** Luminance plane. */
  y: I420Plane;
  /** Blue-difference chrominance plane, half resolution in each dimension. */
  u: I420Plane;
  /** Red-difference chrominance plane, half resolution in each dimension. */
  v: I420Plane;
  /** Local receive time, in nanoseconds on a monotonic clock. */
  timestampNs: bigint;
  /** When the sender captured the frame, in nanoseconds, if the sender reported it. */
  captureTimestampNs?: bigint;
  /** RTP timestamp from the packet that carried this frame, if available. */
  rtpTimestamp?: number;
  /** Monotonically increasing counter identifying this frame within the track. */
  frameId: number;
  /** Clockwise rotation to apply on display, in degrees. */
  rotation?: 0 | 90 | 180 | 270;
}

/** A PCM audio frame to push into a {@link LocalAudioTrack} via its `write` method. `pcm` is int16 mono samples at 48 kHz; `frames` is the sample count. */
export interface AudioFrameInput {
  /** Interleaved signed 16-bit little-endian samples, `frames * 2` bytes long. */
  pcm: Buffer;
  /** Number of samples per channel in {@link AudioFrameInput.pcm}. */
  frames: number;
}

/** A PCM audio frame delivered to a {@link RemoteAudioTrack}'s frame callback. Always `PCM_S16LE`; `frameId` increments per frame. */
export interface AudioFrame {
  /** Always `'PCM_S16LE'`. The only sample format this SDK delivers. */
  format: 'PCM_S16LE';
  /** Samples per second. */
  sampleRate: number;
  /** Number of interleaved channels in {@link AudioFrame.pcm}. */
  channels: number;
  /** Number of samples per channel in {@link AudioFrame.pcm}. */
  frames: number;
  /** Interleaved signed 16-bit little-endian samples. */
  pcm: Buffer;
  /** Local receive time, in nanoseconds on a monotonic clock. */
  timestampNs: bigint;
  /** Monotonically increasing counter identifying this frame within the track. */
  frameId: number;
}

/** Options for {@link createLocalVideoTrack}. */
export interface CreateLocalVideoTrackOptions {
  /** Track name, unique across the local participant's published tracks. Defaults to a generated name such as `video-0`. */
  name?: string;
}

/** Options for {@link createLocalAudioTrack}. */
export interface CreateLocalAudioTrackOptions {
  /** Track name, unique across the local participant's published tracks. Defaults to a generated name such as `audio-0`. */
  name?: string;
}

/** Options for {@link createLocalTracks}. Each key accepts a boolean to toggle the kind, or a per-track options object. */
export interface CreateLocalTracksOptions {
  /** Whether to create an audio track, or the options to create it with. Defaults to `true`. */
  audio?: boolean | CreateLocalAudioTrackOptions;
  /** Whether to create a video track, or the options to create it with. Defaults to `true`. */
  video?: boolean | CreateLocalVideoTrackOptions;
}

// `TwilioError` itself is exported from `./errors.js` as a class. Internal
// modules that only need its shape import it from there as a type.

/** Native media-factory options for creating a video track. */
export interface VideoTrackOptions {
  /** Track name, unique across the local participant's published tracks. */
  name?: string;
}

/** Native media-factory options for creating an audio track. */
export interface AudioTrackOptions {
  /** Track name, unique across the local participant's published tracks. */
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
  /** STUN or TURN server URLs, such as `turn:global.turn.twilio.com:3478`. */
  urls: string[];
  /** Username for a TURN server that requires authentication. */
  username?: string;
  /** Credential for a TURN server that requires authentication. */
  credential?: string;
}

/** ICE transport configuration for {@link ConnectOptions}. `transportPolicy: 'relay'` forces all traffic through TURN. */
export interface IceOptions {
  /**
   * Which candidates to gather. `'relay'` forces all media through TURN,
   * which is useful for testing restrictive networks. Defaults to `'all'`.
   */
  transportPolicy?: 'all' | 'relay';
  /** Servers to use for candidate gathering, replacing the Twilio defaults. */
  iceServers?: IceServer[];
}

/** Maximum send bitrates, in bits per second. Omitted fields leave the corresponding limit unchanged. */
export interface EncodingParameters {
  /** Ceiling on outgoing audio bitrate, in bits per second. */
  maxAudioBitrate?: number;
  /** Ceiling on outgoing video bitrate, in bits per second. */
  maxVideoBitrate?: number;
}

/** Audio codecs that may be negotiated, in preference order. */
export type AudioCodec = 'opus' | 'PCMU';
/** Video codec that may be negotiated. */
export type VideoCodec = 'VP8';

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
  /** How available bandwidth is divided between subscribed video tracks. */
  mode?: BandwidthProfileMode;
  /** Ceiling on the total incoming video bitrate, in bits per second. */
  maxSubscriptionBitrate?: number;
  /** When the server may stop delivering a subscribed video track to save bandwidth. */
  trackSwitchOffMode?: TrackSwitchOffMode;
  /** Whether the SDK or the application decides which tracks are switched off. */
  clientTrackSwitchOffControl?: ClientTrackSwitchOffControl;
  /**
   * Whether the SDK or the application chooses render dimensions.
   * {@link RemoteVideoTrack.setContentPreferences} takes effect only under `'manual'`.
   */
  contentPreferencesMode?: VideoContentPreferencesMode;
}

/** Bandwidth-profile options passed to {@link connect} to manage subscriber-side bandwidth. */
export interface BandwidthProfileOptions {
  /** Bandwidth settings for subscribed video tracks. */
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
  /** Remote participant verbosity. `0` disables reporting for remote participants. */
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
  /** How outgoing video encodings are selected. */
  videoEncodingMode?: VideoEncodingMode;
  /** Limits on incoming media, controlling how subscribed tracks share bandwidth. */
  bandwidthProfile?: BandwidthProfileOptions;
  /** Subscribe to live transcriptions, delivered via the Room's `transcription` event. */
  receiveTranscriptions?: boolean;
  /** Signaling region to connect through (e.g. `us1`, `gll` for lowest-latency). */
  region?: string;
  /** Overrides for ICE candidate gathering and transport policy. */
  iceOptions?: IceOptions;
  /** Initial send-bitrate limits; equivalent to calling {@link LocalParticipant.setEncodingParameters} after connect. */
  encodingParameters?: EncodingParameters;
}

/** The kind of media a track carries. */
export type TrackKind = 'video' | 'audio' | 'data';

/** A local video track that the application feeds with I420 frames. Create via {@link createLocalVideoTrack}. */
export interface LocalVideoTrack {
  /** Track name, unique across the local participant's published tracks. */
  readonly name: string;
  /** Always `'video'`. */
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
  /** Track name, unique across the local participant's published tracks. */
  readonly name: string;
  /** Always `'audio'`. */
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
  /** Track name, unique across the local participant's published tracks. Defaults to a generated name such as `data-0`. */
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
  /** Track name, unique across the local participant's published tracks. */
  readonly name: string;
  /** Always `'data'`. */
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
  /** Whether messages are delivered in the order they were sent. */
  readonly ordered: boolean;
  /** Send a message to all subscribed remote participants. */
  send(data: string | Buffer): void;
}

/** Desired render dimensions for a remote video track, used to right-size the publisher's encoding. */
export interface VideoRenderDimensions {
  /** Desired width in pixels. Must be a positive integer. */
  width: number;
  /** Desired height in pixels. Must be a positive integer. */
  height: number;
}

/** Per-track content preferences for a {@link RemoteVideoTrack}, applied via `setContentPreferences`. */
export interface VideoContentPreferences {
  /** Dimensions the application intends to render this track at. */
  renderDimensions?: VideoRenderDimensions;
}

/**
 * A remote participant's video track. Attach a frame callback via `onFrame` to
 * receive decoded {@link VideoFrame}s; only one callback is active at a time.
 */
export interface RemoteVideoTrack {
  /** Track name, as set by the publishing participant. */
  readonly name: string;
  /** Always `'video'`. */
  readonly kind: 'video';
  /** The track's SID (`MT...`), assigned by the server when published. */
  readonly sid: Track.SID;
  /** Whether the publisher currently has this track enabled. */
  readonly enabled: boolean;
  /** Whether the SDK has switched this track off (no frames delivered) under bandwidth pressure. Tracks the `videoTrackSwitchedOff`/`videoTrackSwitchedOn` events. */
  readonly isSwitchedOff: boolean;
  /** Register the frame callback, replacing any previous one. */
  onFrame(callback: (frame: VideoFrame) => void): void;
  /** Remove the frame callback so frames stop being delivered. Pair with `onFrame` to release the listener. */
  removeFrameCallback(): void;
  /**
   * Tell the server what dimensions this track will be rendered at, so it can
   * pick a matching encoding. Takes effect only when the Room was joined with
   * a bandwidth profile whose `contentPreferencesMode` is `'manual'`.
   *
   * @param preferences - The desired render dimensions.
   */
  setContentPreferences(preferences: VideoContentPreferences): void;
}

/**
 * A remote participant's audio track. Attach a frame callback via `onFrame` to
 * receive decoded {@link AudioFrame}s; only one callback is active at a time.
 */
export interface RemoteAudioTrack {
  /** Track name, as set by the publishing participant. */
  readonly name: string;
  /** Always `'audio'`. */
  readonly kind: 'audio';
  /** The track's SID (`MT...`), assigned by the server when published. */
  readonly sid: Track.SID;
  /** Whether the publisher currently has this track enabled. */
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
  /** Track name, as set by the publishing participant. */
  readonly name: string;
  /** Always `'data'`. */
  readonly kind: 'data';
  /** The track's SID (`MT...`), assigned by the server when published. */
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
  /** Whether the publisher sends messages in order. */
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
  /** SID of the track this event is about. */
  trackSid: Track.SID;
  /** Name of the track this event is about. */
  trackName: string;
}

/** Payload for the `trackEnabled`/`trackDisabled` events. */
export interface RemoteTrackStateEvent extends RemoteTrackPublishEvent {
  /** Whether the local client is subscribed to the track. */
  isSubscribed: boolean;
}

/**
 * Payload for the `trackSubscriptionFailed` event, identifying the publication that
 * could not be subscribed to. Includes `kind` so a listener can route the failure
 * without looking `trackSid` up in the participant's track collections.
 */
export interface RemoteTrackSubscriptionFailedEvent extends RemoteTrackPublishEvent {
  /** Whether the track is `video`, `audio`, or `data`. */
  kind: TrackKind;
}

/** Width/height in pixels reported in track stats. */
export interface StatsVideoDimensions {
  /** Frame width in pixels. */
  width: number;
  /** Frame height in pixels. */
  height: number;
}

/** Stats common to every track. `timestamp` is in milliseconds since the Unix epoch; `trackSid` is the Track SID (`MT...`). */
export interface TrackStats {
  /** Name of the codec negotiated for this track, such as `opus` or `VP8`. */
  codec: string;
  /** Packets lost on this track over the connection's lifetime. */
  packetsLost: number;
  /** RTP synchronization source identifier for this track's stream. */
  ssrc: string;
  /** When this snapshot was taken, in milliseconds since the Unix epoch. */
  timestamp: number;
  /** SID of the track these stats describe. */
  trackSid: Track.SID;
}

/** Send-side stats for a local track. `roundTripTime` is in seconds. */
export interface LocalTrackStats extends TrackStats {
  /** Bytes sent for this track over the connection's lifetime. */
  bytesSent: number;
  /** Packets sent for this track over the connection's lifetime. */
  packetsSent: number;
  /** Most recent round-trip time to the server, in seconds. */
  roundTripTime: number;
}

/** Receive-side stats for a remote track. */
export interface RemoteTrackStats extends TrackStats {
  /** Bytes received for this track over the connection's lifetime. */
  bytesReceived: number;
  /** Packets received for this track over the connection's lifetime. */
  packetsReceived: number;
}

/** Send-side audio stats. `audioLevel` is the linear input level; `jitter` is in milliseconds. */
export interface LocalAudioTrackStats extends LocalTrackStats {
  /** Linear input level of the audio being sent. */
  audioLevel: number;
  /** Variation in packet arrival timing, in milliseconds. */
  jitter: number;
}

/** Send-side video stats. `captureDimensions`/`captureFrameRate` describe input, `dimensions`/`frameRate` describe what is encoded. */
export interface LocalVideoTrackStats extends LocalTrackStats {
  /** Dimensions of the frames written into the track, before encoding. */
  captureDimensions: StatsVideoDimensions;
  /** Dimensions of the frames actually encoded and sent. */
  dimensions: StatsVideoDimensions;
  /** Rate at which frames are written into the track, in frames per second. */
  captureFrameRate: number;
  /** Rate at which frames are encoded and sent, in frames per second. */
  frameRate: number;
  /** Frames encoded for this track over the connection's lifetime. */
  framesEncoded: number;
}

/** Receive-side audio stats. `audioLevel` is the linear output level; `jitter` is in milliseconds. */
export interface RemoteAudioTrackStats extends RemoteTrackStats {
  /** Linear output level of the audio being received. */
  audioLevel: number;
  /** Variation in packet arrival timing, in milliseconds. */
  jitter: number;
}

/** Receive-side video stats describing the decoded stream. */
export interface RemoteVideoTrackStats extends RemoteTrackStats {
  /** Dimensions of the decoded frames. */
  dimensions: StatsVideoDimensions;
  /** Rate at which frames are received and decoded, in frames per second. */
  frameRate: number;
}

/** A stats snapshot for one peer connection, returned by {@link Room.getStats}. */
export interface StatsReport {
  /** Identifier of the peer connection these stats came from. */
  peerConnectionId: string;
  /** Send-side stats, one entry per published audio track. */
  localAudioTrackStats: LocalAudioTrackStats[];
  /** Send-side stats, one entry per published video track. */
  localVideoTrackStats: LocalVideoTrackStats[];
  /** Receive-side stats, one entry per subscribed audio track. */
  remoteAudioTrackStats: RemoteAudioTrackStats[];
  /** Receive-side stats, one entry per subscribed video track. */
  remoteVideoTrackStats: RemoteVideoTrackStats[];
}

/** A {@link Room}'s connection state. */
export type RoomState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

/** Native SDK log verbosity, from `off` (silent) to `all` (most verbose). Set via {@link setLogLevel}. */
export type LogLevel = 'off' | 'fatal' | 'error' | 'warning' | 'info' | 'debug' | 'trace' | 'all';

// Internal: the shape of the native C++ addon
/** @internal */
export interface NativeAddon {
  getVersion(): string;
  setLogLevel(level: LogLevel | number): void;
  connect(token: string, options: Record<string, unknown>): NativeRoom;
  MediaFactory: new () => NativeMediaFactory;
}

/** @internal */
export interface NativeMediaFactory {
  createVideoTrack(options: VideoTrackOptions): LocalVideoTrack;
  createAudioTrack(options: AudioTrackOptions): LocalAudioTrack;
  createDataTrack(options: LocalDataTrackOptions): LocalDataTrack;
}

/** @internal */
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

/** @internal */
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

/** @internal */
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
