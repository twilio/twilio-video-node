import type {
  NativeLocalParticipant,
  EncodingParameters,
  LocalVideoTrack,
  LocalAudioTrack,
  LocalDataTrack,
  ParticipantState,
  TwilioError,
  TrackPublication as RawTrackPublication,
} from './types.js';
import { TypedEventEmitter } from './typed_emitter.js';
import {
  LocalVideoTrackPublication,
  LocalAudioTrackPublication,
  LocalDataTrackPublication,
  type LocalTrackPublication,
  type LocalTrack,
} from './track_publication.js';

export type LocalParticipantEvents = {
  trackPublished: (publication: RawTrackPublication) => void;
  trackPublicationFailed: (error: TwilioError) => void;
  networkQualityLevelChanged: (level: number) => void;
};

export class LocalParticipant extends TypedEventEmitter<LocalParticipantEvents> {
  /** @internal */
  readonly _native: NativeLocalParticipant;
  private _publishedTracks = new Map<string, LocalTrack>();

  constructor(nativeParticipant: NativeLocalParticipant) {
    super();
    this._native = nativeParticipant;

    this._native.setEventCallback((event: string, data?: unknown) => {
      this.emit(event, data);
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
      map.set(raw.trackSid, new LocalVideoTrackPublication(raw, track ?? null));
    }
    return map;
  }

  get audioTracks(): Map<string, LocalAudioTrackPublication> {
    const map = new Map<string, LocalAudioTrackPublication>();
    for (const raw of this._native.audioTracks) {
      const track = this._publishedTracks.get(raw.trackName) as LocalAudioTrack | undefined;
      map.set(raw.trackSid, new LocalAudioTrackPublication(raw, track ?? null));
    }
    return map;
  }

  get dataTracks(): Map<string, LocalDataTrackPublication> {
    const map = new Map<string, LocalDataTrackPublication>();
    for (const raw of this._native.dataTracks) {
      const track = this._publishedTracks.get(raw.trackName) as LocalDataTrack | undefined;
      map.set(raw.trackSid, new LocalDataTrackPublication(raw, track ?? null));
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

  publishTracks(tracks: (LocalVideoTrack | LocalAudioTrack | LocalDataTrack)[]): boolean[] {
    return tracks.map(t => this.publishTrack(t));
  }

  unpublishTracks(tracks: (LocalVideoTrack | LocalAudioTrack | LocalDataTrack)[]): boolean[] {
    return tracks.map(t => this.unpublishTrack(t));
  }

  setEncodingParameters(params?: EncodingParameters): void {
    this._native.setEncodingParameters(params);
  }
}
