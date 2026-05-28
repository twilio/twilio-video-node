import { LocalParticipant } from './local_participant.js';
import { RemoteParticipant } from './remote_participant.js';
import { TypedEventEmitter } from './typed_emitter.js';
import type {
  NativeRoom,
  NativeRemoteParticipant,
  RoomState,
  RemoteVideoTrack,
  RemoteAudioTrack,
  RemoteDataTrack,
  StatsReport,
} from './types.js';
import { TwilioError, liftTwilioError } from './errors.js';

export type RoomEvents = {
  connected: () => void;
  disconnected: (error?: TwilioError) => void;
  connectFailure: (error: TwilioError) => void;
  reconnecting: (error?: TwilioError) => void;
  reconnected: () => void;
  participantConnected: (participant: RemoteParticipant) => void;
  participantDisconnected: (participant: RemoteParticipant) => void;
  participantReconnecting: (participant: RemoteParticipant) => void;
  participantReconnected: (participant: RemoteParticipant) => void;
  dominantSpeakerChanged: (participant: RemoteParticipant | null) => void;
  recordingStarted: () => void;
  recordingStopped: () => void;
  transcription: (transcriptionJson: string) => void;
  trackSubscribed: (
    track: RemoteVideoTrack | RemoteAudioTrack | RemoteDataTrack,
    participant: RemoteParticipant,
  ) => void;
  trackUnsubscribed: (
    track: RemoteVideoTrack | RemoteAudioTrack | RemoteDataTrack,
    participant: RemoteParticipant,
  ) => void;
  trackPublished: (publication: unknown, participant: RemoteParticipant) => void;
  trackUnpublished: (publication: unknown, participant: RemoteParticipant) => void;
  trackEnabled: (publication: unknown, participant: RemoteParticipant) => void;
  trackDisabled: (publication: unknown, participant: RemoteParticipant) => void;
  videoTrackSwitchedOff: (track: RemoteVideoTrack, participant: RemoteParticipant) => void;
  videoTrackSwitchedOn: (track: RemoteVideoTrack, participant: RemoteParticipant) => void;
};

const PARTICIPANT_EVENTS = new Set([
  'participantConnected',
  'participantDisconnected',
  'participantReconnecting',
  'participantReconnected',
  'dominantSpeakerChanged',
]);

const ROOM_ERROR_EVENTS = new Set(['connectFailure']);

// These events may be emitted without an associated error.
const ROOM_OPTIONAL_ERROR_EVENTS = new Set(['disconnected', 'reconnecting']);

const BUBBLED_TRACK_EVENTS = [
  'trackSubscribed',
  'trackUnsubscribed',
  'trackPublished',
  'trackUnpublished',
  'trackEnabled',
  'trackDisabled',
  'videoTrackSwitchedOff',
  'videoTrackSwitchedOn',
] as const;

export class Room extends TypedEventEmitter<RoomEvents> {
  /** @internal */
  readonly _native: NativeRoom;
  private _localParticipant: LocalParticipant | null = null;
  private _remoteParticipantCache = new Map<string, RemoteParticipant>();

  constructor(nativeRoom: NativeRoom) {
    super();
    this._native = nativeRoom;

    this._native.setEventCallback((event: string, data?: unknown) => {
      if (PARTICIPANT_EVENTS.has(event)) {
        const wrapped = data ? this._wrapRemoteParticipant(data as NativeRemoteParticipant) : null;
        this.emit(event, wrapped);
        if (event === 'participantDisconnected' && wrapped) {
          wrapped.dispose();
          this._remoteParticipantCache.delete(wrapped.sid);
        }
      } else if (ROOM_ERROR_EVENTS.has(event)) {
        this.emit(event, liftTwilioError(data));
      } else if (ROOM_OPTIONAL_ERROR_EVENTS.has(event)) {
        this.emit(event, data ? liftTwilioError(data) : undefined);
      } else {
        this.emit(event, data);
      }
    });
  }

  get name(): string {
    return this._native.name;
  }

  get sid(): string {
    return this._native.sid;
  }

  get state(): RoomState {
    return this._native.state as RoomState;
  }

  get mediaRegion(): string {
    return this._native.mediaRegion;
  }

  get isRecording(): boolean {
    return this._native.isRecording;
  }

  get dominantSpeaker(): RemoteParticipant | null {
    const native = this._native.dominantSpeaker;
    if (!native) return null;
    return this._wrapRemoteParticipant(native);
  }

  get localParticipant(): LocalParticipant {
    if (!this._localParticipant) {
      this._localParticipant = new LocalParticipant(this._native.localParticipant);
    }
    return this._localParticipant;
  }

  get participants(): Map<string, RemoteParticipant> {
    const natives = this._native.remoteParticipants;
    const map = new Map<string, RemoteParticipant>();

    for (const native of natives) {
      map.set(native.sid, this._wrapRemoteParticipant(native));
    }

    // Evict stale cache entries
    for (const sid of this._remoteParticipantCache.keys()) {
      if (!map.has(sid)) {
        this._remoteParticipantCache.delete(sid);
      }
    }

    return map;
  }

  /** @deprecated Use `participants` instead. */
  get remoteParticipants(): RemoteParticipant[] {
    return [...this.participants.values()];
  }

  getStats(): Promise<StatsReport[]> {
    if (this.state === 'disconnected') {
      return Promise.reject(new Error('Room is disconnected'));
    }
    return new Promise((resolve, reject) => {
      this._native.getStats((error: Error | null, reports: StatsReport[]) => {
        if (error) {
          reject(error);
        } else {
          resolve(reports);
        }
      });
    });
  }

  disconnect(): void {
    this._native.disconnect();
  }

  dispose(): void {
    if (this._localParticipant) {
      this._localParticipant.dispose();
      this._localParticipant = null;
    }
    for (const participant of this._remoteParticipantCache.values()) {
      participant.dispose();
    }
    this._remoteParticipantCache.clear();
    this._native.dispose();
    this.removeAllListeners();
  }

  private _bubbleTrackEvents(participant: RemoteParticipant): void {
    for (const event of BUBBLED_TRACK_EVENTS) {
      participant.on(event, (trackOrPub: unknown) => {
        this.emit(event, trackOrPub, participant);
      });
    }
  }

  private _wrapRemoteParticipant(native: NativeRemoteParticipant): RemoteParticipant {
    const sid = native.sid;
    let wrapped = this._remoteParticipantCache.get(sid);
    if (!wrapped) {
      wrapped = new RemoteParticipant(native);
      this._bubbleTrackEvents(wrapped);
      this._remoteParticipantCache.set(sid, wrapped);
    }
    return wrapped;
  }
}
