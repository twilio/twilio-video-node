import { LocalParticipant } from './local_participant.js';
import { RemoteParticipant, type RemoteParticipantEvents } from './remote_participant.js';
import { TypedEventEmitter } from './typed_emitter.js';
import type { RemoteVideoTrack, RemoteAudioTrack, RemoteDataTrack } from './remote_track.js';
import { releaseAllRemoteTracks } from './track_registry.js';
import type { LocalTrack } from './track_publication.js';
import type {
  NativeRoom,
  NativeRemoteParticipant,
  RoomState,
  RemoteTrackPublishEvent,
  RemoteTrackStateEvent,
  RemoteTrackSubscriptionFailedEvent,
  StatsReport,
  Participant,
} from './types.js';
import { TwilioError, liftTwilioError } from './errors.js';

/**
 * Listener signatures for every event a {@link Room} can emit.
 *
 * The track events at the end of this map are emitted by each
 * {@link RemoteParticipant} and re-emitted here, with the participant that
 * emitted them appended as the last argument. Listening here handles every
 * participant's tracks in one place, instead of attaching listeners to each
 * participant.
 */
export type RoomEvents = {
  /**
   * The local participant left the Room, either by calling
   * {@link Room.disconnect} or because the server ended the session.
   *
   * @param error - Why the Room ended, or omitted after a local
   * {@link Room.disconnect}.
   */
  disconnected: (error?: TwilioError) => void;
  /**
   * The Room could not be joined. Terminal: no further events follow.
   *
   * Used internally by {@link connect}, which rejects with this error and
   * disposes the partially built Room. Application code never receives a Room
   * on which this can still fire, so failures are handled by catching the
   * rejection from {@link connect}.
   *
   * @param error - Why the connection attempt failed.
   */
  connectFailure: (error: TwilioError) => void;
  /**
   * The signaling or media connection dropped and the SDK is trying to restore
   * it. Media is interrupted until `reconnected` fires.
   *
   * @param error - Why the connection dropped, when the SDK can attribute it.
   */
  reconnecting: (error?: TwilioError) => void;
  /** The connection was restored after `reconnecting`. Media resumes. */
  reconnected: () => void;
  /**
   * A remote participant joined the Room.
   *
   * Not emitted for participants already in the Room when {@link connect}
   * resolved. Those are part of the Room's starting state: read them from
   * {@link Room.participants}.
   *
   * @param participant - The participant that joined.
   */
  participantConnected: (participant: RemoteParticipant) => void;
  /**
   * A remote participant left the Room. Their tracks are unsubscribed first.
   *
   * @param participant - The participant that left.
   */
  participantDisconnected: (participant: RemoteParticipant) => void;
  /**
   * A remote participant lost their connection and is trying to restore it.
   *
   * @param participant - The participant that is reconnecting.
   */
  participantReconnecting: (participant: RemoteParticipant) => void;
  /**
   * A remote participant restored their connection.
   *
   * @param participant - The participant that reconnected.
   */
  participantReconnected: (participant: RemoteParticipant) => void;
  /**
   * The loudest participant changed. Emitted only when the Room was joined with
   * `enableDominantSpeaker: true`.
   *
   * @param participant - The new dominant speaker, or `null` when no one is
   * speaking.
   */
  dominantSpeakerChanged: (participant: RemoteParticipant | null) => void;
  /** Recording started for this Room. */
  recordingStarted: () => void;
  /** Recording stopped for this Room. */
  recordingStopped: () => void;
  /**
   * A transcription result arrived. Emitted only when the Room was joined with
   * `receiveTranscriptions: true`.
   *
   * @param transcriptionJson - The raw transcription payload, as a JSON string.
   */
  transcription: (transcriptionJson: string) => void;
  /**
   * A remote track was subscribed to and is now delivering media or messages.
   *
   * A participant who was already publishing emits this after {@link connect}
   * resolves. Subscriptions that completed before the listener was attached are
   * not replayed; they appear in `participant.tracks` with `isSubscribed` set to
   * `true`.
   *
   * @param track - The subscribed track.
   * @param participant - The participant publishing it.
   */
  trackSubscribed: (
    track: RemoteVideoTrack | RemoteAudioTrack | RemoteDataTrack,
    participant: RemoteParticipant,
  ) => void;
  /**
   * A remote track was unsubscribed from and stops delivering media. Its frame
   * and message callbacks will not fire again.
   *
   * @param track - The unsubscribed track.
   * @param participant - The participant that was publishing it.
   */
  trackUnsubscribed: (
    track: RemoteVideoTrack | RemoteAudioTrack | RemoteDataTrack,
    participant: RemoteParticipant,
  ) => void;
  /**
   * Subscribing to a remote track failed. The track stays unsubscribed.
   *
   * @param error - Why the subscription failed.
   * @param publication - Identifies the track that could not be subscribed to.
   * @param participant - The participant publishing it.
   */
  trackSubscriptionFailed: (
    error: TwilioError,
    publication: RemoteTrackSubscriptionFailedEvent,
    participant: RemoteParticipant,
  ) => void;
  /**
   * A remote participant published a track. Subscription follows separately,
   * and `trackSubscribed` reports it.
   *
   * @param publication - Metadata for the newly published track.
   * @param participant - The participant that published it.
   */
  trackPublished: (publication: RemoteTrackPublishEvent, participant: RemoteParticipant) => void;
  /**
   * A remote participant unpublished a track.
   *
   * @param publication - Metadata for the unpublished track.
   * @param participant - The participant that unpublished it.
   */
  trackUnpublished: (publication: RemoteTrackPublishEvent, participant: RemoteParticipant) => void;
  /**
   * A remote participant unmuted a track they publish.
   *
   * @param publication - Identifies the track that was enabled.
   * @param participant - The participant publishing it.
   */
  trackEnabled: (publication: RemoteTrackStateEvent, participant: RemoteParticipant) => void;
  /**
   * A remote participant muted a track they publish. The track stays subscribed
   * but stops delivering media.
   *
   * @param publication - Identifies the track that was disabled.
   * @param participant - The participant publishing it.
   */
  trackDisabled: (publication: RemoteTrackStateEvent, participant: RemoteParticipant) => void;
  /**
   * The server stopped delivering a subscribed video track, typically to stay
   * within the Room's bandwidth profile. The track stays subscribed and its
   * `isSwitchedOff` reads `true`.
   *
   * @param track - The track that was switched off.
   * @param participant - The participant publishing it.
   */
  videoTrackSwitchedOff: (track: RemoteVideoTrack, participant: RemoteParticipant) => void;
  /**
   * The server resumed delivering a video track that was switched off.
   *
   * @param track - The track that was switched on.
   * @param participant - The participant publishing it.
   */
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
  'trackSubscriptionFailed',
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
      } else if (event === 'disconnected') {
        // End every active frames() iterator before surfacing the event, so a
        // `for await` loop completes rather than hanging on a dead Room.
        releaseAllRemoteTracks();
        this.emit(event, data ? liftTwilioError(data) : undefined);
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
    // Ends every active frames() iterator; without this a `for await` loop on a
    // subscribed track would hang after the Room goes away.
    releaseAllRemoteTracks();
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
      // Variadic forwarding loses the per-event signature, so the handler needs a cast back to it.
      participant.on(event, ((...args: unknown[]) => {
        this.emit(event, ...args, participant);
      }) as RemoteParticipantEvents[typeof event]);
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
