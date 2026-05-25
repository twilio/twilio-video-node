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
  isKeyFrame?: boolean;
  rotation?: 0 | 90 | 180 | 270;
}

export interface AudioFrameInput {
  pcm: Buffer;
  frames: number;
  /** Defaults to the current monotonic time when omitted. */
  timestampNs?: bigint;
}

export interface AudioFrame {
  format: 'PCM_S16LE';
  sampleRate: number;
  channels: number;
  frames: number;
  pcm: Buffer;
  timestampNs: bigint;
  captureTimestampNs?: bigint;
  rtpTimestamp?: number;
  frameId: number;
}

export interface CreateLocalVideoTrackOptions {
  name?: string;
}

export interface CreateLocalAudioTrackOptions {
  name?: string;
}

export interface TwilioError {
  code: number;
  message: string;
}

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

export interface ConnectOptions {
  name?: string;
  videoTracks?: LocalVideoTrack[];
  audioTracks?: LocalAudioTrack[];
  dataTracks?: LocalDataTrack[];
  enableInsights?: boolean;
  enableAutomaticSubscription?: boolean;
  enableDominantSpeaker?: boolean;
  enableNetworkQuality?: boolean;
  region?: string;
  iceOptions?: IceOptions;
  encodingParameters?: EncodingParameters;
}

export type TrackKind = 'video' | 'audio' | 'data';

export interface LocalVideoTrack {
  readonly name: string;
  readonly kind: 'video';
  enabled: boolean;
  write(frame: VideoFrameInput): boolean;
}

export interface LocalAudioTrack {
  readonly name: string;
  readonly kind: 'audio';
  enabled: boolean;
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

export interface RemoteVideoTrack {
  readonly name: string;
  readonly kind: 'video';
  readonly sid: string;
  readonly enabled: boolean;
  readonly isSwitchedOff: boolean;
  onFrame(callback: (frame: VideoFrame) => void): void;
  removeFrameCallback(): void;
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
