import type {
  NativeRemoteParticipant,
  ParticipantState,
  RemoteTrackPublication as RawRemoteTrackPublication,
  Participant,
  Track,
} from './types.js';
import { TwilioError, liftTwilioError } from './errors.js';
import { TypedEventEmitter } from './typed_emitter.js';
import type { RemoteVideoTrack, RemoteAudioTrack, RemoteDataTrack } from './remote_track.js';
import type { TrackRegistry } from './track_registry.js';
import type {
  NativeRemoteAudioTrack,
  NativeRemoteDataTrack,
  NativeRemoteVideoTrack,
} from './types.js';
import {
  RemoteVideoTrackPublication,
  RemoteAudioTrackPublication,
  RemoteDataTrackPublication,
  type RemoteTrackPublication,
} from './track_publication.js';

type NativeAnyRemoteTrack = NativeRemoteVideoTrack | NativeRemoteAudioTrack | NativeRemoteDataTrack;

/**
 * Events whose payload is a remote track object rather than a plain
 * publication record. These are the ones that must be resolved through the
 * track registry.
 */
const TRACK_OBJECT_EVENTS = new Set(['videoTrackSwitchedOff', 'videoTrackSwitchedOn']);

/** Events whose sole argument is the publication the native layer sent. */
const PUBLICATION_EVENTS = new Set([
  'trackPublished',
  'trackUnpublished',
  'trackEnabled',
  'trackDisabled',
]);

/** Wraps a raw publication from the native layer in the class matching its kind. */
function remoteTrackPublicationFor(
  raw: RawRemoteTrackPublication,
  registry: TrackRegistry,
): RemoteTrackPublication {
  switch (raw.kind) {
    case 'video':
      return new RemoteVideoTrackPublication(raw, registry);
    case 'audio':
      return new RemoteAudioTrackPublication(raw, registry);
    default:
      return new RemoteDataTrackPublication(raw, registry);
  }
}

/**
 * Listener signatures for every event a {@link RemoteParticipant} can emit.
 *
 * The track events here are also re-emitted by the {@link Room}, with the
 * participant appended as the last argument. See {@link RoomEvents}.
 * `networkQualityLevelChanged` is not re-emitted, so it must be listened for on
 * each participant.
 */
export type RemoteParticipantEvents = {
  /**
   * One of this participant's tracks was subscribed to and is now delivering
   * media or messages.
   *
   * A participant already publishing when {@link connect} resolved emits this
   * afterwards. Subscriptions that completed before the listener was attached
   * are not replayed; they appear in {@link RemoteParticipant.tracks} with
   * `isSubscribed` set to `true`.
   *
   * @param track - The subscribed track.
   * @param publication - The publication the track was subscribed from.
   */
  trackSubscribed: (
    track: RemoteVideoTrack | RemoteAudioTrack | RemoteDataTrack,
    publication: RemoteTrackPublication,
  ) => void;
  /**
   * One of this participant's tracks was unsubscribed from and stops delivering
   * media. Its frame and message callbacks will not fire again.
   *
   * @param track - The unsubscribed track.
   * @param publication - The publication the track was unsubscribed from.
   */
  trackUnsubscribed: (
    track: RemoteVideoTrack | RemoteAudioTrack | RemoteDataTrack,
    publication: RemoteTrackPublication,
  ) => void;
  /**
   * This participant published a track. Subscription follows separately, and
   * `trackSubscribed` reports it.
   *
   * @param publication - The new publication. Its `track` is set only once
   * subscription completes.
   */
  trackPublished: (publication: RemoteTrackPublication) => void;
  /**
   * This participant unpublished a track.
   *
   * @param publication - The publication that was removed.
   */
  trackUnpublished: (publication: RemoteTrackPublication) => void;
  /**
   * This participant unmuted a track they publish.
   *
   * @param publication - The publication whose track was enabled.
   */
  trackEnabled: (publication: RemoteTrackPublication) => void;
  /**
   * This participant muted a track they publish. The track stays subscribed but
   * stops delivering media.
   *
   * @param publication - The publication whose track was disabled.
   */
  trackDisabled: (publication: RemoteTrackPublication) => void;
  /**
   * Subscribing to one of this participant's tracks failed. The track stays
   * unsubscribed.
   *
   * @param error - Why the subscription failed.
   * @param publication - Identifies the track that could not be subscribed to.
   */
  trackSubscriptionFailed: (error: TwilioError, publication: RemoteTrackPublication) => void;
  /**
   * The server stopped delivering a subscribed video track, typically to stay
   * within the Room's bandwidth profile. The track stays subscribed and its
   * `isSwitchedOff` reads `true`.
   *
   * @param track - The track that was switched off.
   */
  videoTrackSwitchedOff: (track: RemoteVideoTrack) => void;
  /**
   * The server resumed delivering a video track that was switched off.
   *
   * @param track - The track that was switched on.
   */
  videoTrackSwitchedOn: (track: RemoteVideoTrack) => void;
  /**
   * This participant's network quality changed. Emitted only when the Room was
   * joined with network quality enabled for remote participants.
   *
   * @param level - Quality from 0 (worst) to 5 (best).
   */
  networkQualityLevelChanged: (level: number) => void;
};

/**
 * A remote participant in a {@link Room}, reachable via {@link Room.participants}.
 * Emits track subscription and state events listed in {@link RemoteParticipantEvents}.
 * Instances are managed by the Room; consumers do not construct or dispose them.
 */
export class RemoteParticipant extends TypedEventEmitter<RemoteParticipantEvents> {
  /** @internal */
  readonly _native: NativeRemoteParticipant;
  /** @internal The owning Room's track registry. */
  private readonly _registry: TrackRegistry;

  /** @internal */
  constructor(nativeParticipant: NativeRemoteParticipant, registry: TrackRegistry) {
    super();
    this._native = nativeParticipant;
    this._registry = registry;

    this._native.setEventCallback((event: string, data?: unknown) => {
      if (event === 'trackSubscriptionFailed') {
        const { error, publication } = (data ?? {}) as {
          error?: unknown;
          publication?: RawRemoteTrackPublication;
        };
        this.emit(
          event,
          liftTwilioError(error),
          publication ? remoteTrackPublicationFor(publication, registry) : publication,
        );
      } else if (event === 'trackSubscribed' || event === 'trackUnsubscribed') {
        // The native layer sends { track, publication }, and mints a fresh
        // track object per event. Resolve the track through the registry so
        // listeners get the same wrapper a frames() consumer is iterating, and
        // pass the publication alongside it.
        const { track, publication } = (data ?? {}) as {
          track: NativeAnyRemoteTrack;
          publication: RawRemoteTrackPublication;
        };
        const wrapped = registry.wrapRemoteTrack(track);
        this.emit(event, wrapped, remoteTrackPublicationFor(publication, registry));
        if (event === 'trackUnsubscribed') {
          // Ends any active frames() iterator so a `for await` loop exits
          // rather than hanging on a track that will never produce again.
          registry.releaseRemoteTrack(wrapped.sid);
        }
      } else if (PUBLICATION_EVENTS.has(event)) {
        const publication = data as RawRemoteTrackPublication | undefined;
        if (publication) this.emit(event, remoteTrackPublicationFor(publication, registry));
      } else if (TRACK_OBJECT_EVENTS.has(event)) {
        // Switched-off/on still carry the track alone.
        this.emit(event, registry.wrapRemoteTrack(data as NativeAnyRemoteTrack));
      } else {
        this.emit(event, data);
      }
    });
  }

  /** This participant's identity, as set in the `identity` grant of their access token. */
  get identity(): Participant.Identity {
    return this._native.identity;
  }

  /** This participant's SID (`PA...`), unique within the Room. */
  get sid(): Participant.SID {
    return this._native.sid;
  }

  /** Current connection state of this participant within the Room. */
  get state(): ParticipantState {
    return this._native.state as ParticipantState;
  }

  /**
   * Network quality score from `0` (worst) to `5` (best), or `null` when remote
   * network-quality reporting was not enabled at {@link connect}. Updated by the
   * `networkQualityLevelChanged` event.
   */
  get networkQualityLevel(): number | null {
    return this._native.networkQualityLevel;
  }

  /** This participant's published video tracks, keyed by Track SID (`MT...`). A fresh map is built on each access. */
  get videoTracks(): Map<Track.SID, RemoteVideoTrackPublication> {
    const map = new Map<Track.SID, RemoteVideoTrackPublication>();
    for (const raw of this._native.videoTracks) {
      map.set(raw.trackSid, new RemoteVideoTrackPublication(raw, this._registry));
    }
    return map;
  }

  /** This participant's published audio tracks, keyed by Track SID (`MT...`). A fresh map is built on each access. */
  get audioTracks(): Map<Track.SID, RemoteAudioTrackPublication> {
    const map = new Map<Track.SID, RemoteAudioTrackPublication>();
    for (const raw of this._native.audioTracks) {
      map.set(raw.trackSid, new RemoteAudioTrackPublication(raw, this._registry));
    }
    return map;
  }

  /** This participant's published data tracks, keyed by Track SID (`MT...`). A fresh map is built on each access. */
  get dataTracks(): Map<Track.SID, RemoteDataTrackPublication> {
    const map = new Map<Track.SID, RemoteDataTrackPublication>();
    for (const raw of this._native.dataTracks) {
      map.set(raw.trackSid, new RemoteDataTrackPublication(raw, this._registry));
    }
    return map;
  }

  /** All of this participant's published tracks (video, audio, and data) merged into one map, keyed by Track SID (`MT...`). */
  get tracks(): Map<Track.SID, RemoteTrackPublication> {
    const map = new Map<Track.SID, RemoteTrackPublication>();
    for (const [sid, pub] of this.videoTracks) map.set(sid, pub);
    for (const [sid, pub] of this.audioTracks) map.set(sid, pub);
    for (const [sid, pub] of this.dataTracks) map.set(sid, pub);
    return map;
  }

  /** Release this participant's event listeners. Called by the {@link Room} on `participantDisconnected` and {@link Room.dispose}. */
  dispose(): void {
    this.removeAllListeners();
  }
}
