export interface VideoFrameMetadata {
  width: number;
  height: number;
  strideY: number;
  strideU: number;
  strideV: number;
  timestampUs: number;
  rotation: 0 | 90 | 180 | 270;
}

export interface AudioFrameMetadata {
  bitsPerSample: number;
  sampleRate: number;
  numberOfChannels: number;
  numberOfFrames: number;
  timestampUs: number;
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
  pushFrame(
    yPlane: Buffer,
    uPlane: Buffer,
    vPlane: Buffer,
    width: number,
    height: number,
    timestampUs?: number,
  ): void;
}

export interface LocalAudioTrack {
  readonly name: string;
  readonly kind: 'audio';
  enabled: boolean;
  pushSamples(samples: Buffer): void;
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
  onFrame(
    callback: (
      yPlane: Buffer,
      uPlane: Buffer,
      vPlane: Buffer,
      metadata: VideoFrameMetadata,
    ) => void,
  ): void;
  removeFrameCallback(): void;
}

export interface RemoteAudioTrack {
  readonly name: string;
  readonly kind: 'audio';
  readonly sid: string;
  readonly enabled: boolean;
  onData(callback: (samples: Buffer, metadata: AudioFrameMetadata) => void): void;
  removeDataCallback(): void;
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

export type RoomState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export type LogLevel = 'off' | 'fatal' | 'error' | 'warning' | 'info' | 'debug' | 'trace' | 'all';

// Internal: the shape of the native C++ addon
export interface NativeAddon {
  getVersion(): string;
  setLogLevel(level: LogLevel | number): void;
  connect(token: string, options: Record<string, unknown>): NativeRoom;
  MediaFactory: new () => NativeMediaFactory;
  LocalDataTrack: new (options?: Record<string, unknown>) => LocalDataTrack;
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
