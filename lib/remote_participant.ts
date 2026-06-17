import type {
  NativeRemoteParticipant,
  ParticipantState,
  RemoteVideoTrack,
  RemoteAudioTrack,
  RemoteDataTrack,
  RemoteTrackPublication as RawRemoteTrackPublication,
} from './types.js';
import { TwilioError, liftTwilioError } from './errors.js';
import { TypedEventEmitter } from './typed_emitter.js';
import {
  RemoteVideoTrackPublication,
  RemoteAudioTrackPublication,
  RemoteDataTrackPublication,
  type RemoteTrackPublication,
} from './track_publication.js';

export type RemoteParticipantEvents = {
  trackSubscribed: (track: RemoteVideoTrack | RemoteAudioTrack | RemoteDataTrack) => void;
  trackUnsubscribed: (track: RemoteVideoTrack | RemoteAudioTrack | RemoteDataTrack) => void;
  trackPublished: (publication: RawRemoteTrackPublication) => void;
  trackUnpublished: (publication: RawRemoteTrackPublication) => void;
  trackEnabled: (publication: RawRemoteTrackPublication) => void;
  trackDisabled: (publication: RawRemoteTrackPublication) => void;
  trackSubscriptionFailed: (error: TwilioError) => void;
  videoTrackSwitchedOff: (track: RemoteVideoTrack) => void;
  videoTrackSwitchedOn: (track: RemoteVideoTrack) => void;
  networkQualityLevelChanged: (level: number) => void;
};

export class RemoteParticipant extends TypedEventEmitter<RemoteParticipantEvents> {
  /** @internal */
  readonly _native: NativeRemoteParticipant;

  constructor(nativeParticipant: NativeRemoteParticipant) {
    super();
    this._native = nativeParticipant;

    this._native.setEventCallback((event: string, data?: unknown) => {
      if (event === 'trackSubscriptionFailed') {
        this.emit(event, liftTwilioError(data));
      } else {
        this.emit(event, data);
      }
    });
  }

  get identity(): string {
    return this._native.identity;
  }

  get sid(): string {
    return this._native.sid;
  }

  get state(): ParticipantState {
    return this._native.state as ParticipantState;
  }

  get networkQualityLevel(): number | null {
    return this._native.networkQualityLevel;
  }

  get videoTracks(): Map<string, RemoteVideoTrackPublication> {
    const map = new Map<string, RemoteVideoTrackPublication>();
    for (const raw of this._native.videoTracks) {
      map.set(raw.trackSid, new RemoteVideoTrackPublication(raw));
    }
    return map;
  }

  get audioTracks(): Map<string, RemoteAudioTrackPublication> {
    const map = new Map<string, RemoteAudioTrackPublication>();
    for (const raw of this._native.audioTracks) {
      map.set(raw.trackSid, new RemoteAudioTrackPublication(raw));
    }
    return map;
  }

  get dataTracks(): Map<string, RemoteDataTrackPublication> {
    const map = new Map<string, RemoteDataTrackPublication>();
    for (const raw of this._native.dataTracks) {
      map.set(raw.trackSid, new RemoteDataTrackPublication(raw));
    }
    return map;
  }

  get tracks(): Map<string, RemoteTrackPublication> {
    const map = new Map<string, RemoteTrackPublication>();
    for (const [sid, pub] of this.videoTracks) map.set(sid, pub);
    for (const [sid, pub] of this.audioTracks) map.set(sid, pub);
    for (const [sid, pub] of this.dataTracks) map.set(sid, pub);
    return map;
  }

  dispose(): void {
    this.removeAllListeners();
  }
}
