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
} from './types.js';

export class TrackPublication {
  readonly trackSid: string;
  readonly trackName: string;
  readonly kind: TrackKind;
  readonly isTrackEnabled: boolean;

  constructor(raw: RawTrackPublication) {
    this.trackSid = raw.trackSid;
    this.trackName = raw.trackName;
    this.kind = raw.kind;
    this.isTrackEnabled = raw.isTrackEnabled;
  }
}

export type LocalTrack = LocalVideoTrack | LocalAudioTrack | LocalDataTrack;

export class LocalTrackPublication extends TrackPublication {
  track: LocalTrack | null;
  #participant: { unpublishTrack(track: LocalTrack): boolean } | null;

  constructor(
    raw: RawTrackPublication,
    track: LocalTrack | null = null,
    participant: { unpublishTrack(track: LocalTrack): boolean } | null = null,
  ) {
    super(raw);
    this.track = track;
    this.#participant = participant;
  }

  unpublish(): boolean {
    if (!this.#participant || !this.track) return false;
    const ok = this.#participant.unpublishTrack(this.track);
    if (ok) {
      this.track = null;
      this.#participant = null;
    }
    return ok;
  }
}

export class LocalVideoTrackPublication extends LocalTrackPublication {
  declare readonly kind: 'video';
  declare track: LocalVideoTrack | null;
}

export class LocalAudioTrackPublication extends LocalTrackPublication {
  declare readonly kind: 'audio';
  declare track: LocalAudioTrack | null;
}

export class LocalDataTrackPublication extends LocalTrackPublication {
  declare readonly kind: 'data';
  declare track: LocalDataTrack | null;
}

export type RemoteTrack = RemoteVideoTrack | RemoteAudioTrack | RemoteDataTrack;

export class RemoteTrackPublication extends TrackPublication {
  readonly isSubscribed: boolean;
  readonly track: RemoteTrack | undefined;

  constructor(raw: RawRemoteTrackPublication) {
    super(raw);
    this.isSubscribed = raw.isSubscribed;
    this.track = raw.track;
  }
}

export class RemoteVideoTrackPublication extends RemoteTrackPublication {
  declare readonly kind: 'video';
  declare readonly track: RemoteVideoTrack | undefined;
}

export class RemoteAudioTrackPublication extends RemoteTrackPublication {
  declare readonly kind: 'audio';
  declare readonly track: RemoteAudioTrack | undefined;
}

export class RemoteDataTrackPublication extends RemoteTrackPublication {
  declare readonly kind: 'data';
  declare readonly track: RemoteDataTrack | undefined;
}
