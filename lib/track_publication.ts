import type {
  TrackKind,
  TrackPublication as RawTrackPublication,
  RemoteTrackPublication as RawRemoteTrackPublication,
  LocalVideoTrack,
  LocalAudioTrack,
  LocalDataTrack,
  RemoteVideoTrack,
  RemoteAudioTrack,
  RemoteDataTrack,
  Track,
} from './types.js';

/**
 * A snapshot of a published track's metadata. Base class for the local and
 * remote publication types; instances are immutable point-in-time views rebuilt
 * each time a participant's track collection is read.
 */
export class TrackPublication {
  /** The published track's SID (`MT...`), unique per track. */
  readonly trackSid: Track.SID;
  /** The track name set at creation; defaults to the track's ID when unnamed. */
  readonly trackName: string;
  /** Whether this publication is a `video`, `audio`, or `data` track. */
  readonly kind: TrackKind;
  /** Whether the track was enabled at the time this snapshot was taken. */
  readonly isTrackEnabled: boolean;

  constructor(raw: RawTrackPublication) {
    this.trackSid = raw.trackSid;
    this.trackName = raw.trackName;
    this.kind = raw.kind;
    this.isTrackEnabled = raw.isTrackEnabled;
  }
}

/** Any kind of local track the SDK can publish. */
export type LocalTrack = LocalVideoTrack | LocalAudioTrack | LocalDataTrack;

/** A publication of a {@link LocalTrack}, returned by {@link LocalParticipant}'s track collections. */
export class LocalTrackPublication extends TrackPublication {
  /** The published local track, or `null` if the SDK could not resolve the instance for this publication. */
  track: LocalTrack | null;
  #unpublish: ((track: LocalTrack) => boolean) | null;

  constructor(
    raw: RawTrackPublication,
    track: LocalTrack | null = null,
    unpublish: ((track: LocalTrack) => boolean) | null = null,
  ) {
    super(raw);
    this.track = track;
    this.#unpublish = unpublish;
  }

  /**
   * Unpublish the underlying track from the room. Idempotent: a second call is
   * a no-op. The publication's {@link track} remains readable after unpublishing.
   *
   * @returns This publication.
   */
  unpublish(): this {
    if (this.#unpublish && this.track) {
      this.#unpublish(this.track);
      this.#unpublish = null;
    }
    return this;
  }
}

/** A {@link LocalTrackPublication} narrowed to a video track. */
export class LocalVideoTrackPublication extends LocalTrackPublication {
  declare readonly kind: 'video';
  declare track: LocalVideoTrack | null;
}

/** A {@link LocalTrackPublication} narrowed to an audio track. */
export class LocalAudioTrackPublication extends LocalTrackPublication {
  declare readonly kind: 'audio';
  declare track: LocalAudioTrack | null;
}

/** A {@link LocalTrackPublication} narrowed to a data track. */
export class LocalDataTrackPublication extends LocalTrackPublication {
  declare readonly kind: 'data';
  declare track: LocalDataTrack | null;
}

/** Any kind of remote track the SDK can subscribe to. */
export type RemoteTrack = RemoteVideoTrack | RemoteAudioTrack | RemoteDataTrack;

/** A publication of a remote participant's track, returned by {@link RemoteParticipant}'s track collections. */
export class RemoteTrackPublication extends TrackPublication {
  /** Whether the local client is subscribed to this track. */
  readonly isSubscribed: boolean;
  /** The subscribed remote track, or `undefined` until subscription completes (or if unsubscribed). */
  readonly track: RemoteTrack | undefined;

  constructor(raw: RawRemoteTrackPublication) {
    super(raw);
    this.isSubscribed = raw.isSubscribed;
    this.track = raw.track;
  }
}

/** A {@link RemoteTrackPublication} narrowed to a video track. */
export class RemoteVideoTrackPublication extends RemoteTrackPublication {
  declare readonly kind: 'video';
  declare readonly track: RemoteVideoTrack | undefined;
}

/** A {@link RemoteTrackPublication} narrowed to an audio track. */
export class RemoteAudioTrackPublication extends RemoteTrackPublication {
  declare readonly kind: 'audio';
  declare readonly track: RemoteAudioTrack | undefined;
}

/** A {@link RemoteTrackPublication} narrowed to a data track. */
export class RemoteDataTrackPublication extends RemoteTrackPublication {
  declare readonly kind: 'data';
  declare readonly track: RemoteDataTrack | undefined;
}
