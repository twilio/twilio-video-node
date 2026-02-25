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

export interface DataTrackOptions {
    name?: string;
    maxPacketLifeTime?: number;
    maxRetransmits?: number;
    ordered?: boolean;
}

export interface PlatformInfo {
    sdkVersion?: string;
    platformName?: string;
    platformVersion?: string;
    deviceArchitecture?: string;
    deviceManufacturer?: string;
    deviceModel?: string;
}

export interface IceServer {
    urls: string[];
    username?: string;
    credential?: string;
}

export interface IceOptions {
    /** 'all' (default) or 'relay' (force TURN) */
    transportPolicy?: 'all' | 'relay';
    iceServers?: IceServer[];
}

export interface ConnectOptions {
    name?: string;
    mediaFactory?: MediaFactory;
    videoTracks?: LocalVideoTrack[];
    audioTracks?: LocalAudioTrack[];
    dataTracks?: LocalDataTrack[];
    enableInsights?: boolean;
    enableAutomaticSubscription?: boolean;
    enableDominantSpeaker?: boolean;
    enableNetworkQuality?: boolean;
    region?: string;
    platformInfo?: PlatformInfo;
    iceOptions?: IceOptions;
}

export interface LocalVideoTrack {
    readonly name: string;
    enabled: boolean;
    pushFrame(yPlane: Buffer, uPlane: Buffer, vPlane: Buffer, width: number, height: number, timestampUs?: number): void;
}

export interface LocalAudioTrack {
    readonly name: string;
    enabled: boolean;
    pushSamples(samples: Buffer, sampleRate: number, channels: number): void;
}

export interface LocalDataTrack {
    readonly name: string;
    readonly maxPacketLifeTime: number;
    readonly maxRetransmits: number;
    readonly reliable: boolean;
    readonly ordered: boolean;
    send(data: string | Buffer): void;
}

export interface RemoteVideoTrack {
    readonly name: string;
    readonly sid: string;
    readonly enabled: boolean;
    readonly isSwitchedOff: boolean;
    onFrame(callback: (yPlane: Buffer, uPlane: Buffer, vPlane: Buffer, metadata: VideoFrameMetadata) => void): void;
    removeFrameCallback(): void;
}

export interface RemoteAudioTrack {
    readonly name: string;
    readonly sid: string;
    readonly enabled: boolean;
    onData(callback: (samples: Buffer, metadata: AudioFrameMetadata) => void): void;
    removeDataCallback(): void;
}

export interface RemoteDataTrack {
    readonly name: string;
    readonly sid: string;
    readonly reliable: boolean;
    readonly ordered: boolean;
    onMessage(callback: (data: string | Buffer) => void): void;
    removeMessageCallback(): void;
}

export interface TrackPublication {
    trackSid: string;
    trackName: string;
}

export interface RemoteTrackPublication extends TrackPublication {
    isSubscribed: boolean;
    track?: RemoteVideoTrack | RemoteAudioTrack | RemoteDataTrack;
}

export interface LocalParticipant {
    readonly identity: string;
    readonly sid: string;
    readonly signalingRegion: string;
    readonly videoTracks: TrackPublication[];
    readonly audioTracks: TrackPublication[];
    readonly dataTracks: TrackPublication[];
    publishTrack(track: LocalVideoTrack | LocalAudioTrack | LocalDataTrack): boolean;
    unpublishTrack(track: LocalVideoTrack | LocalAudioTrack | LocalDataTrack): boolean;
}

export interface RemoteParticipant {
    readonly identity: string;
    readonly sid: string;
    readonly videoTracks: RemoteTrackPublication[];
    readonly audioTracks: RemoteTrackPublication[];
    readonly dataTracks: RemoteTrackPublication[];
    on(event: 'trackSubscribed', handler: (track: RemoteVideoTrack | RemoteAudioTrack | RemoteDataTrack) => void): this;
    on(event: 'trackUnsubscribed', handler: (track: RemoteVideoTrack | RemoteAudioTrack | RemoteDataTrack) => void): this;
    on(event: 'trackSubscriptionFailed', handler: (error: TwilioError) => void): this;
    on(event: 'trackEnabled', handler: (publication: RemoteTrackPublication) => void): this;
    on(event: 'trackDisabled', handler: (publication: RemoteTrackPublication) => void): this;
    off(event: string): this;
}

export type RoomState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export interface Room {
    readonly name: string;
    readonly sid: string;
    readonly state: RoomState;
    readonly mediaRegion: string;
    readonly isRecording: boolean;
    readonly localParticipant: LocalParticipant;
    readonly remoteParticipants: RemoteParticipant[];
    disconnect(): void;
    dispose(): void;
    on(event: 'connected', handler: () => void): this;
    on(event: 'disconnected', handler: (error?: TwilioError) => void): this;
    on(event: 'connectFailure', handler: (error: TwilioError) => void): this;
    on(event: 'reconnecting', handler: (error: TwilioError) => void): this;
    on(event: 'reconnected', handler: () => void): this;
    on(event: 'participantConnected', handler: (participant: RemoteParticipant) => void): this;
    on(event: 'participantDisconnected', handler: (participant: RemoteParticipant) => void): this;
    on(event: 'participantReconnecting', handler: (participant: RemoteParticipant) => void): this;
    on(event: 'participantReconnected', handler: (participant: RemoteParticipant) => void): this;
    on(event: 'recordingStarted', handler: () => void): this;
    on(event: 'recordingStopped', handler: () => void): this;
    on(event: 'dominantSpeakerChanged', handler: (participant: RemoteParticipant | null) => void): this;
    off(event: string): this;
}

export interface MediaFactory {
    createVideoTrack(options?: VideoTrackOptions): LocalVideoTrack;
    createAudioTrack(options?: AudioTrackOptions): LocalAudioTrack;
    createDataTrack(options?: DataTrackOptions): LocalDataTrack;
}

export interface MediaFactoryOptions {
    platformInfo?: PlatformInfo;
}

export type LogLevel = 'off' | 'fatal' | 'error' | 'warning' | 'info' | 'debug' | 'trace' | 'all';

export declare const ErrorCode: {
    readonly ACCESS_TOKEN_INVALID: 20101;
    readonly ACCESS_TOKEN_HEADER_INVALID: 20102;
    readonly ACCESS_TOKEN_ISSUER_INVALID: 20103;
    readonly ACCESS_TOKEN_EXPIRED: 20104;
    readonly ACCESS_TOKEN_NOT_YET_VALID: 20105;
    readonly ACCESS_TOKEN_GRANT_INVALID: 20106;
    readonly ACCESS_TOKEN_SIGNATURE_INVALID: 20107;
    readonly SIGNALING_CONNECTION_ERROR: 53000;
    readonly SIGNALING_CONNECTION_DISCONNECTED: 53001;
    readonly SIGNALING_CONNECTION_TIMEOUT: 53002;
    readonly ROOM_NOT_FOUND: 53106;
    readonly ROOM_CONNECT_FAILED: 53104;
    readonly ROOM_MAX_PARTICIPANTS_EXCEEDED: 53105;
    readonly ROOM_COMPLETED: 53118;
    readonly PARTICIPANT_DUPLICATE_IDENTITY: 53205;
    readonly TRACK_INVALID: 53300;
    readonly TRACK_NAME_TOO_LONG: 53301;
    readonly TRACK_NAME_CHARS_INVALID: 53303;
    readonly MEDIA_CLIENT_LOCAL_DESC_FAILED: 53400;
    readonly MEDIA_SERVER_LOCAL_DESC_FAILED: 53401;
    readonly MEDIA_CLIENT_REMOTE_DESC_FAILED: 53402;
    readonly MEDIA_SERVER_REMOTE_DESC_FAILED: 53403;
    readonly MEDIA_NO_SUPPORTED_CODEC: 53404;
    readonly MEDIA_CONNECTION_ERROR: 53405;
};

export function getVersion(): string;
export function setLogLevel(level: LogLevel | number): void;
export function connect(token: string, options?: ConnectOptions): Promise<Room>;
export function createLocalVideoTrack(name?: string): LocalVideoTrack;
export function createLocalAudioTrack(name?: string): LocalAudioTrack;
export { MediaFactory as MediaFactoryClass };
