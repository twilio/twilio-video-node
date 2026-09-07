import type {
  NativeRemoteParticipant,
  ParticipantState,
  RemoteVideoTrack,
  RemoteAudioTrack,
  RemoteDataTrack,
  RemoteTrackPublishEvent,
  RemoteTrackStateEvent,
  RemoteTrackSubscriptionFailedEvent,
  RemoteTrackPublication as RawRemoteTrackPublication,
  Participant,
  Track,
} from './types.js';
import { TwilioError, liftTwilioError } from './errors.js';
import { TypedEventEmitter } from './typed_emitter.js';
import {
  RemoteVideoTrackPublication,
  RemoteAudioTrackPublication,
  RemoteDataTrackPublication,
  type RemoteTrackPublication,
} from './track_publication.js';

/** Wraps a raw publication from the native layer in the class matching its kind. */
function remoteTrackPublicationFor(raw: RawRemoteTrackPublication): RemoteTrackPublication {
  switch (raw.kind) {
    case 'video':
      return new RemoteVideoTrackPublication(raw);
    case 'audio':
      return new RemoteAudioTrackPublication(raw);
    default:
      return new RemoteDataTrackPublication(raw);
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
   * @param publication - Metadata for the newly published track.
   */
  trackPublished: (publication: RemoteTrackPublishEvent) => void;
  /**
   * This participant unpublished a track.
   *
   * @param publication - Metadata for the unpublished track.
   */
  trackUnpublished: (publication: RemoteTrackPublishEvent) => void;
  /**
   * This participant unmuted a track they publish.
   *
   * @param publication - Identifies the track that was enabled.
   */
  trackEnabled: (publication: RemoteTrackStateEvent) => void;
  /**
   * This participant muted a track they publish. The track stays subscribed but
   * stops delivering media.
   *
   * @param publication - Identifies the track that was disabled.
   */
  trackDisabled: (publication: RemoteTrackStateEvent) => void;
  /**
   * Subscribing to one of this participant's tracks failed. The track stays
   * unsubscribed.
   *
   * @param error - Why the subscription failed.
   * @param publication - Identifies the track that could not be subscribed to.
   */
  trackSubscriptionFailed: (
    error: TwilioError,
    publication: RemoteTrackSubscriptionFailedEvent,
  ) => void;
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

  /** @internal */
  constructor(nativeParticipant: NativeRemoteParticipant) {
    super();
    this._native = nativeParticipant;

    this._native.setEventCallback((event: string, data?: unknown) => {
      if (event === 'trackSubscribed' || event === 'trackUnsubscribed') {
        const { track, publication } = (data ?? {}) as {
          track: RemoteVideoTrack | RemoteAudioTrack | RemoteDataTrack;
          publication: RawRemoteTrackPublication;
        };
        this.emit(event, track, remoteTrackPublicationFor(publication));
      } else if (event === 'trackSubscriptionFailed') {
        const { error, publication } = (data ?? {}) as {
          error?: unknown;
          publication?: RemoteTrackSubscriptionFailedEvent;
        };
        this.emit(event, liftTwilioError(error), publication);
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
      map.set(raw.trackSid, new RemoteVideoTrackPublication(raw));
    }
    return map;
  }

  /** This participant's published audio tracks, keyed by Track SID (`MT...`). A fresh map is built on each access. */
  get audioTracks(): Map<Track.SID, RemoteAudioTrackPublication> {
    const map = new Map<Track.SID, RemoteAudioTrackPublication>();
    for (const raw of this._native.audioTracks) {
      map.set(raw.trackSid, new RemoteAudioTrackPublication(raw));
    }
    return map;
  }

  /** This participant's published data tracks, keyed by Track SID (`MT...`). A fresh map is built on each access. */
  get dataTracks(): Map<Track.SID, RemoteDataTrackPublication> {
    const map = new Map<Track.SID, RemoteDataTrackPublication>();
    for (const raw of this._native.dataTracks) {
      map.set(raw.trackSid, new RemoteDataTrackPublication(raw));
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
