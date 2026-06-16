import type {
  NativeLocalParticipant,
  EncodingParameters,
  LocalVideoTrack,
  LocalAudioTrack,
  LocalDataTrack,
  ParticipantState,
  TrackPublication as RawTrackPublication,
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

export type LocalParticipantEvents = {
  trackPublished: (publication: LocalTrackPublication) => void;
  trackPublicationFailed: (error: TwilioError) => void;
  networkQualityLevelChanged: (level: number) => void;
};

export class LocalParticipant extends TypedEventEmitter<LocalParticipantEvents> {
  /** @internal */
  readonly _native: NativeLocalParticipant;
  private _publishedTracks = new Map<string, LocalTrack>();
  private _unpublishFn = (track: LocalTrack): boolean => this.unpublishTrack(track);

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

  get signalingRegion(): string {
    return this._native.signalingRegion;
  }

  get videoTracks(): Map<string, LocalVideoTrackPublication> {
    const map = new Map<string, LocalVideoTrackPublication>();
    for (const raw of this._native.videoTracks) {
      const track = this._publishedTracks.get(raw.trackName) as LocalVideoTrack | undefined;
      map.set(raw.trackSid, new LocalVideoTrackPublication(raw, track ?? null, this._unpublishFn));
    }
    return map;
  }

  get audioTracks(): Map<string, LocalAudioTrackPublication> {
    const map = new Map<string, LocalAudioTrackPublication>();
    for (const raw of this._native.audioTracks) {
      const track = this._publishedTracks.get(raw.trackName) as LocalAudioTrack | undefined;
      map.set(raw.trackSid, new LocalAudioTrackPublication(raw, track ?? null, this._unpublishFn));
    }
    return map;
  }

  get dataTracks(): Map<string, LocalDataTrackPublication> {
    const map = new Map<string, LocalDataTrackPublication>();
    for (const raw of this._native.dataTracks) {
      const track = this._publishedTracks.get(raw.trackName) as LocalDataTrack | undefined;
      map.set(raw.trackSid, new LocalDataTrackPublication(raw, track ?? null, this._unpublishFn));
    }
    return map;
  }

  get tracks(): Map<string, LocalTrackPublication> {
    const map = new Map<string, LocalTrackPublication>();
    for (const [sid, pub] of this.videoTracks) map.set(sid, pub);
    for (const [sid, pub] of this.audioTracks) map.set(sid, pub);
    for (const [sid, pub] of this.dataTracks) map.set(sid, pub);
    return map;
  }

  publishTrack(track: LocalVideoTrack | LocalAudioTrack | LocalDataTrack): boolean {
    this._assertUniqueName(track as LocalTrack);
    const result = this._native.publishTrack(track);
    if (result) {
      this._publishedTracks.set(track.name, track as LocalTrack);
    }
    return result;
  }

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
        return undefined;
    }
  }

  publishTracks(tracks: (LocalVideoTrack | LocalAudioTrack | LocalDataTrack)[]): boolean[] {
    return tracks.map(t => this.publishTrack(t));
  }

  unpublishTracks(tracks: (LocalVideoTrack | LocalAudioTrack | LocalDataTrack)[]): boolean[] {
    return tracks.map(t => this.unpublishTrack(t));
  }

  setEncodingParameters(params?: EncodingParameters): void {
    this._native.setEncodingParameters(params);
  }

  dispose(): void {
    this._publishedTracks.clear();
    this.removeAllListeners();
  }
}
