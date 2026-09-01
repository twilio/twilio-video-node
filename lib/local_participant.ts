import type {
  NativeLocalParticipant,
  EncodingParameters,
  LocalVideoTrack,
  LocalAudioTrack,
  LocalDataTrack,
  ParticipantState,
  TrackPublication as RawTrackPublication,
  Participant,
  Track,
} from './types.js';
import { TwilioError, liftTwilioError } from './errors.js';
import { TypedEventEmitter } from './typed_emitter.js';
import {
  LocalVideoTrackPublication,
  LocalAudioTrackPublication,
  LocalDataTrackPublication,
  type LocalTrackPublication,
  type LocalTrack,
} from './track_publication.js';

/** Listener signatures for every event a {@link LocalParticipant} can emit. */
export type LocalParticipantEvents = {
  /**
   * A local track finished publishing and remote participants can now subscribe
   * to it.
   *
   * @param publication - The resulting publication, including the track's
   * server-assigned SID.
   */
  trackPublished: (publication: LocalTrackPublication) => void;
  /**
   * Publishing a local track failed. The track is not published, and remote
   * participants never see it.
   *
   * @param error - Why publishing failed.
   */
  trackPublicationFailed: (error: TwilioError) => void;
  /**
   * The local participant's network quality changed. Emitted only when the Room
   * was joined with network quality enabled for the local participant.
   *
   * @param level - Quality from 0 (worst) to 5 (best).
   */
  networkQualityLevelChanged: (level: number) => void;
};

/**
 * The local client's participant in a {@link Room}, reachable via
 * {@link Room.localParticipant}. Use it to publish and unpublish local tracks.
 * Track names must be unique across this participant's published tracks.
 */
export class LocalParticipant extends TypedEventEmitter<LocalParticipantEvents> {
  /** @internal */
  readonly _native: NativeLocalParticipant;
  private _publishedTracks = new Map<string, LocalTrack>();
  private _unpublishFn = (track: LocalTrack): boolean => this.unpublishTrack(track);

  /** @internal */
  constructor(
    nativeParticipant: NativeLocalParticipant,
    seededTracks: ReadonlyArray<LocalTrack> = [],
  ) {
    super();
    this._native = nativeParticipant;
    // Seed before setEventCallback wires up so a synchronously-delivered
    // native event resolves against a fully-populated publication map.
    for (const track of seededTracks) {
      this._assertUniqueName(track);
      this._publishedTracks.set(track.name, track);
    }

    this._native.setEventCallback((event: string, data?: unknown) => {
      if (event === 'trackPublicationFailed') {
        // The native publish only failed asynchronously; drop the entry inserted
        // by publishTrack so the name is free to re-publish. Safe to key by name:
        // _assertUniqueName guarantees one instance per name.
        const trackName = (data as { trackName?: string } | undefined)?.trackName;
        if (trackName) this._publishedTracks.delete(trackName);
        this.emit(event, liftTwilioError(data));
      } else if (event === 'trackPublished') {
        const pub = this._resolvePublishedTrack(data as RawTrackPublication | undefined);
        if (pub) this.emit(event, pub);
      } else {
        this.emit(event, data);
      }
    });
  }

  /** This participant's identity, taken from the `identity` grant in the access token. */
  get identity(): Participant.Identity {
    return this._native.identity;
  }

  /** This participant's SID (`PA...`), assigned by Twilio on connect. */
  get sid(): Participant.SID {
    return this._native.sid;
  }

  /** Current connection state of the local participant within the Room. */
  get state(): ParticipantState {
    return this._native.state as ParticipantState;
  }

  /**
   * Network quality score from `0` (worst) to `5` (best), or `null` when
   * network-quality reporting was not enabled at {@link connect}. Updated by
   * the `networkQualityLevelChanged` event.
   */
  get networkQualityLevel(): number | null {
    return this._native.networkQualityLevel;
  }

  /** The geographic region (e.g. `us1`) of the signaling server this participant is connected to. */
  get signalingRegion(): string {
    return this._native.signalingRegion;
  }

  /** Published video tracks, keyed by Track SID (`MT...`). A fresh map is built on each access. */
  get videoTracks(): Map<Track.SID, LocalVideoTrackPublication> {
    const map = new Map<Track.SID, LocalVideoTrackPublication>();
    for (const raw of this._native.videoTracks) {
      const track = this._publishedTracks.get(raw.trackName) as LocalVideoTrack | undefined;
      map.set(raw.trackSid, new LocalVideoTrackPublication(raw, track ?? null, this._unpublishFn));
    }
    return map;
  }

  /** Published audio tracks, keyed by Track SID (`MT...`). A fresh map is built on each access. */
  get audioTracks(): Map<Track.SID, LocalAudioTrackPublication> {
    const map = new Map<Track.SID, LocalAudioTrackPublication>();
    for (const raw of this._native.audioTracks) {
      const track = this._publishedTracks.get(raw.trackName) as LocalAudioTrack | undefined;
      map.set(raw.trackSid, new LocalAudioTrackPublication(raw, track ?? null, this._unpublishFn));
    }
    return map;
  }

  /** Published data tracks, keyed by Track SID (`MT...`). A fresh map is built on each access. */
  get dataTracks(): Map<Track.SID, LocalDataTrackPublication> {
    const map = new Map<Track.SID, LocalDataTrackPublication>();
    for (const raw of this._native.dataTracks) {
      const track = this._publishedTracks.get(raw.trackName) as LocalDataTrack | undefined;
      map.set(raw.trackSid, new LocalDataTrackPublication(raw, track ?? null, this._unpublishFn));
    }
    return map;
  }

  /** All published tracks (video, audio, and data) merged into one map, keyed by Track SID (`MT...`). */
  get tracks(): Map<Track.SID, LocalTrackPublication> {
    const map = new Map<Track.SID, LocalTrackPublication>();
    for (const [sid, pub] of this.videoTracks) map.set(sid, pub);
    for (const [sid, pub] of this.audioTracks) map.set(sid, pub);
    for (const [sid, pub] of this.dataTracks) map.set(sid, pub);
    return map;
  }

  /**
   * Publish a local track to the Room. Returns synchronously; the actual
   * publication is confirmed later by the `trackPublished` event or, on
   * failure, `trackPublicationFailed`.
   *
   * @returns `true` if the native publish was accepted, `false` otherwise.
   * @throws {Error} If a different track instance is already published under the same name.
   */
  publishTrack(track: LocalVideoTrack | LocalAudioTrack | LocalDataTrack): boolean {
    this._assertUniqueName(track as LocalTrack);
    const result = this._native.publishTrack(track);
    if (result) {
      this._publishedTracks.set(track.name, track as LocalTrack);
    }
    return result;
  }

  /**
   * Stop publishing a local track. The track object itself is not stopped and
   * may be re-published.
   *
   * @returns `true` if the track was published and is now unpublished, `false` otherwise.
   */
  unpublishTrack(track: LocalVideoTrack | LocalAudioTrack | LocalDataTrack): boolean {
    const result = this._native.unpublishTrack(track);
    if (result) {
      this._publishedTracks.delete(track.name);
    }
    return result;
  }

  /**
   * Guards the name-keying of `_publishedTracks`.
   * @throws {Error} If a different track instance is already published under `track.name`.
   */
  private _assertUniqueName(track: LocalTrack): void {
    const existing = this._publishedTracks.get(track.name);
    if (existing && existing !== track) {
      throw new Error(
        `A different track named "${track.name}" is already published. Track names must be unique.`,
      );
    }
  }

  /**
   * Builds the publication for `trackPublished`, resolving the track instance by
   * name when known and falling back to the payload so a publish is never dropped.
   */
  private _resolvePublishedTrack(
    raw: RawTrackPublication | undefined,
  ): LocalTrackPublication | undefined {
    if (!raw?.trackSid) return undefined;
    const track = this._publishedTracks.get(raw.trackName);
    switch (raw.kind) {
      case 'video':
        return new LocalVideoTrackPublication(
          raw,
          (track as LocalVideoTrack) ?? null,
          this._unpublishFn,
        );
      case 'audio':
        return new LocalAudioTrackPublication(
          raw,
          (track as LocalAudioTrack) ?? null,
          this._unpublishFn,
        );
      case 'data':
        return new LocalDataTrackPublication(
          raw,
          (track as LocalDataTrack) ?? null,
          this._unpublishFn,
        );
      default:
        throw new Error(`Unexpected track kind: ${raw.kind}`);
    }
  }

  /**
   * Publish several tracks in order, returning one result per track. Stops and
   * rethrows if any track's name collides (see {@link LocalParticipant.publishTrack}),
   * so tracks before the failing one may already be published.
   *
   * @returns The per-track results, index-aligned with `tracks`.
   * @throws {Error} If a different track instance is already published under the same name.
   */
  publishTracks(tracks: (LocalVideoTrack | LocalAudioTrack | LocalDataTrack)[]): boolean[] {
    return tracks.map(t => this.publishTrack(t));
  }

  /**
   * Unpublish several tracks, returning one result per track.
   *
   * @returns The per-track results, index-aligned with `tracks`.
   */
  unpublishTracks(tracks: (LocalVideoTrack | LocalAudioTrack | LocalDataTrack)[]): boolean[] {
    return tracks.map(t => this.unpublishTrack(t));
  }

  /**
   * Set the maximum send bitrates for published audio and video. Applies to all
   * current and future published tracks; omitted fields keep their current limit.
   */
  setEncodingParameters(params?: EncodingParameters): void {
    this._native.setEncodingParameters(params);
  }

  /** Release this participant's cached publications and event listeners. Called by {@link Room.dispose}. */
  dispose(): void {
    this._publishedTracks.clear();
    this.removeAllListeners();
  }
}
