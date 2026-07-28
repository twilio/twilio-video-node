import { LocalParticipant } from './local_participant.js';
import { RemoteParticipant } from './remote_participant.js';
import { TypedEventEmitter } from './typed_emitter.js';
import type { LocalTrack } from './track_publication.js';
import type {
  NativeRoom,
  NativeRemoteParticipant,
  RoomState,
  RemoteVideoTrack,
  RemoteAudioTrack,
  RemoteDataTrack,
  RemoteTrackPublishEvent,
  RemoteTrackStateEvent,
  StatsReport,
  Participant,
} from './types.js';
import { TwilioError, liftTwilioError } from './errors.js';

/** Listener signatures for every event a {@link Room} can emit. */
export type RoomEvents = {
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
  trackPublished: (publication: RemoteTrackPublishEvent, participant: RemoteParticipant) => void;
  trackUnpublished: (publication: RemoteTrackPublishEvent, participant: RemoteParticipant) => void;
  trackEnabled: (publication: RemoteTrackStateEvent, participant: RemoteParticipant) => void;
  trackDisabled: (publication: RemoteTrackStateEvent, participant: RemoteParticipant) => void;
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

/**
 * A connected Group Room. Obtained by awaiting {@link connect}; the SDK never
 * constructs one directly for consumers. Emits the lifecycle, participant, and
 * track events listed in {@link RoomEvents}. Call {@link Room.dispose} when done
 * to release native resources and listeners.
 */
export class Room extends TypedEventEmitter<RoomEvents> {
  /** @internal */
  readonly _native: NativeRoom;
  private _localParticipant: LocalParticipant | null = null;
  private _remoteParticipantCache = new Map<Participant.SID, RemoteParticipant>();
  private _seededTracks: ReadonlyArray<LocalTrack>;

  /**
   * @internal `onConnected` fires once for the native connect signal, which is
   * already consumed by {@link connect} before the Room is handed to the caller.
   */
  constructor(
    nativeRoom: NativeRoom,
    seededTracks: ReadonlyArray<LocalTrack> = [],
    onConnected?: () => void,
  ) {
    super();
    this._native = nativeRoom;
    this._seededTracks = seededTracks;

    this._native.setEventCallback((event: string, data?: unknown) => {
      if (event === 'connected') {
        this._seedExistingParticipants();
        onConnected?.();
        onConnected = undefined;
      } else if (PARTICIPANT_EVENTS.has(event)) {
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

  /** The name passed to {@link connect}, or the Room SID if no name was given. */
  get name(): string {
    return this._native.name;
  }

  /** This Room's SID (`RM...`), unique per room instance. */
  get sid(): Room.SID {
    return this._native.sid;
  }

  /** Current connection state. Transitions are mirrored by the corresponding lifecycle events. */
  get state(): RoomState {
    return this._native.state as RoomState;
  }

  /** The geographic region (e.g. `us1`) where the Room's media is being processed. */
  get mediaRegion(): string {
    return this._native.mediaRegion;
  }

  /** Whether the Room is currently being recorded. Tracks the `recordingStarted`/`recordingStopped` events. */
  get isRecording(): boolean {
    return this._native.isRecording;
  }

  /**
   * The participant currently speaking loudest, or `null` when no one is
   * dominant. Only populated when the Room was connected with dominant-speaker
   * detection enabled. Updated by the `dominantSpeakerChanged` event.
   */
  get dominantSpeaker(): RemoteParticipant | null {
    const native = this._native.dominantSpeaker;
    if (!native) return null;
    return this._wrapRemoteParticipant(native);
  }

  /** The {@link LocalParticipant} representing this client. Lazily created and cached on first access. */
  get localParticipant(): LocalParticipant {
    if (!this._localParticipant) {
      this._localParticipant = new LocalParticipant(
        this._native.localParticipant,
        this._seededTracks,
      );
    }
    return this._localParticipant;
  }

  /**
   * The remote participants currently connected, keyed by Participant SID
   * (`PA...`). A fresh map is returned on each access; the {@link RemoteParticipant}
   * instances are cached, so repeated reads return the same objects.
   */
  get participants(): Map<Participant.SID, RemoteParticipant> {
    const natives = this._native.remoteParticipants;
    const map = new Map<Participant.SID, RemoteParticipant>();

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

  /**
   * Sample current media statistics, one {@link StatsReport} per underlying
   * peer connection.
   *
   * @returns A promise that rejects if the Room is already `disconnected`.
   */
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

  /**
   * Leave the Room. Triggers the `disconnected` event once teardown completes;
   * does not release the JS-side wrapper — call {@link Room.dispose} for that.
   */
  disconnect(): void {
    this._native.disconnect();
  }

  /**
   * Disconnect (if still connected) and release all native resources, cached
   * participant wrappers, and event listeners. The Room is unusable afterward.
   */
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

  /**
   * Wraps every participant already in the Room, so their track events are
   * observable from the moment the Room connects.
   */
  private _seedExistingParticipants(): void {
    for (const native of this._native.remoteParticipants) {
      this._wrapRemoteParticipant(native);
    }
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

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Room {
  /** A Room SID (`RM...`), unique per room instance. */
  export type SID = string;
}
