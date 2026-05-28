export interface I420Plane {
  data: Buffer;
  stride: number;
  width: number;
  height: number;
}

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

export interface AudioFrameInput {
  pcm: Buffer;
  frames: number;
}

export interface AudioFrame {
  format: 'PCM_S16LE';
  sampleRate: number;
  channels: number;
  frames: number;
  pcm: Buffer;
  timestampNs: bigint;
  frameId: number;
}

export interface CreateLocalVideoTrackOptions {
  name?: string;
}

export interface CreateLocalAudioTrackOptions {
  name?: string;
}

// `TwilioError` itself is exported from `./errors.js` as a class. Internal
// modules that only need its shape import it from there as a type.

export interface VideoTrackOptions {
  name?: string;
}

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

export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface IceOptions {
  transportPolicy?: 'all' | 'relay';
  iceServers?: IceServer[];
}

export interface EncodingParameters {
  maxAudioBitrate?: number;
  maxVideoBitrate?: number;
}

export type AudioCodec = 'opus' | 'PCMA' | 'PCMU' | 'G722';
export type VideoCodec = 'H264' | 'VP8' | 'VP9';

export type VideoEncodingMode = 'auto';

export type BandwidthProfileMode = 'collaboration' | 'grid' | 'presentation';
export type TrackSwitchOffMode = 'detected' | 'predicted' | 'disabled';
export type ClientTrackSwitchOffControl = 'auto' | 'manual';
export type VideoContentPreferencesMode = 'auto' | 'manual';

export interface VideoBandwidthProfileOptions {
  mode?: BandwidthProfileMode;
  maxSubscriptionBitrate?: number;
  trackSwitchOffMode?: TrackSwitchOffMode;
  clientTrackSwitchOffControl?: ClientTrackSwitchOffControl;
  contentPreferencesMode?: VideoContentPreferencesMode;
}

export interface BandwidthProfileOptions {
  video?: VideoBandwidthProfileOptions;
}

/**
 * Network-quality reporting verbosity. `0` disables, `1` enables minimal
 * reporting.
 */
export type NetworkQualityVerbosity = 0 | 1;

export interface NetworkQualityConfiguration {
  /** Local participant verbosity. Only `1` is valid; to disable reporting, pass `networkQuality: false`. */
  local?: 1;
  remote?: NetworkQualityVerbosity;
}

export interface ConnectOptions {
  name?: string;
  videoTracks?: LocalVideoTrack[];
  audioTracks?: LocalAudioTrack[];
  dataTracks?: LocalDataTrack[];
  enableInsights?: boolean;
  enableAutomaticSubscription?: boolean;
  enableDominantSpeaker?: boolean;
  /**
   * Enable network-quality reporting. Pass `true` for default verbosity
   * (`local=1`, `remote=0`) or an object to set verbosities individually.
   * Setting `false` (or omitting) disables reporting.
   */
  networkQuality?: boolean | NetworkQualityConfiguration;
  preferredAudioCodecs?: AudioCodec[];
  preferredVideoCodecs?: VideoCodec[];
  videoEncodingMode?: VideoEncodingMode;
  bandwidthProfile?: BandwidthProfileOptions;
  receiveTranscriptions?: boolean;
  region?: string;
  iceOptions?: IceOptions;
  encodingParameters?: EncodingParameters;
}

export type TrackKind = 'video' | 'audio' | 'data';

export interface LocalVideoTrack {
  readonly name: string;
  readonly kind: 'video';
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

export interface LocalAudioTrack {
  readonly name: string;
  readonly kind: 'audio';
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
  clearBuffer(): void;
}

export interface LocalDataTrackOptions {
  name?: string;
  maxPacketLifeTime?: number;
  maxRetransmits?: number;
  ordered?: boolean;
}

export interface LocalDataTrack {
  readonly name: string;
  readonly kind: 'data';
  readonly maxPacketLifeTime: number;
  readonly maxRetransmits: number;
  readonly reliable: boolean;
  readonly ordered: boolean;
  send(data: string | Buffer): void;
}

export interface VideoRenderDimensions {
  width: number;
  height: number;
}

export interface VideoContentPreferences {
  renderDimensions?: VideoRenderDimensions;
}

export interface RemoteVideoTrack {
  readonly name: string;
  readonly kind: 'video';
  readonly sid: string;
  readonly enabled: boolean;
  readonly isSwitchedOff: boolean;
  onFrame(callback: (frame: VideoFrame) => void): void;
  removeFrameCallback(): void;
  setContentPreferences(preferences: VideoContentPreferences): void;
}

export interface RemoteAudioTrack {
  readonly name: string;
  readonly kind: 'audio';
  readonly sid: string;
  readonly enabled: boolean;
  onFrame(callback: (frame: AudioFrame) => void): void;
  removeFrameCallback(): void;
}

export interface RemoteDataTrack {
  readonly name: string;
  readonly kind: 'data';
  readonly sid: string;
  readonly reliable: boolean;
  readonly ordered: boolean;
  onMessage(callback: (data: string | Buffer) => void): void;
  removeMessageCallback(): void;
}

export interface TrackPublication {
  trackSid: string;
  trackName: string;
  kind: TrackKind;
  isTrackEnabled: boolean;
}

export interface RemoteTrackPublication extends TrackPublication {
  isSubscribed: boolean;
  track?: RemoteVideoTrack | RemoteAudioTrack | RemoteDataTrack;
}

export interface StatsVideoDimensions {
  width: number;
  height: number;
}

export interface TrackStats {
  codec: string;
  packetsLost: number;
  ssrc: string;
  timestamp: number;
  trackSid: string;
}

export interface LocalTrackStats extends TrackStats {
  bytesSent: number;
  packetsSent: number;
  roundTripTime: number;
}

export interface RemoteTrackStats extends TrackStats {
  bytesReceived: number;
  packetsReceived: number;
}

export interface LocalAudioTrackStats extends LocalTrackStats {
  audioLevel: number;
  jitter: number;
}

export interface LocalVideoTrackStats extends LocalTrackStats {
  captureDimensions: StatsVideoDimensions;
  dimensions: StatsVideoDimensions;
  captureFrameRate: number;
  frameRate: number;
  framesEncoded: number;
}

export interface RemoteAudioTrackStats extends RemoteTrackStats {
  audioLevel: number;
  jitter: number;
}

export interface RemoteVideoTrackStats extends RemoteTrackStats {
  dimensions: StatsVideoDimensions;
  frameRate: number;
}

export interface StatsReport {
  peerConnectionId: string;
  localAudioTrackStats: LocalAudioTrackStats[];
  localVideoTrackStats: LocalVideoTrackStats[];
  remoteAudioTrackStats: RemoteAudioTrackStats[];
  remoteVideoTrackStats: RemoteVideoTrackStats[];
}

export type RoomState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

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
