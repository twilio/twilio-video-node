import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Room } from './room.js';
import type {
  NativeAddon,
  NativeMediaFactory,
  ConnectOptions,
  LocalVideoTrack,
  LocalAudioTrack,
  LocalDataTrack,
  LocalDataTrackOptions,
  LogLevel,
  PlatformInfo,
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
export type {
  ConnectOptions,
  IceOptions,
  IceServer,
  EncodingParameters,
  VideoFrameMetadata,
  AudioFrameMetadata,
  TwilioError,
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
} from './types.js';

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

export function connect(token: string, options: ConnectOptions = {}): Promise<Room> {
  const internalOpts: Record<string, unknown> = { ...options };

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
    const room = new Room(nativeRoom);

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

export function createLocalVideoTrack(name?: string): LocalVideoTrack {
  return getDefaultMediaFactory().createVideoTrack(name ? { name } : {});
}

export function createLocalAudioTrack(name?: string): LocalAudioTrack {
  return getDefaultMediaFactory().createAudioTrack(name ? { name } : {});
}

export function createLocalDataTrack(options: LocalDataTrackOptions | string = {}): LocalDataTrack {
  const opts = typeof options === 'string' ? { name: options } : options;
  if (opts.maxRetransmits != null && opts.maxPacketLifeTime != null) {
    throw new Error('maxRetransmits and maxPacketLifeTime are mutually exclusive');
  }
  if ((opts.maxRetransmits != null && opts.maxRetransmits < 0) ||
      (opts.maxPacketLifeTime != null && opts.maxPacketLifeTime < 0)) {
    throw new Error('maxRetransmits and maxPacketLifeTime must be non-negative');
  }
  return getDefaultMediaFactory().createDataTrack(opts);
}

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

export function getVersion(): string {
  return addon.getVersion();
}

export function setLogLevel(level: LogLevel | number): void {
  addon.setLogLevel(level);
}
