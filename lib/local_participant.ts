import { EventEmitter } from 'node:events';
import type {
  NativeLocalParticipant,
  TrackPublication,
  EncodingParameters,
  LocalVideoTrack,
  LocalAudioTrack,
  LocalDataTrack,
  ParticipantState,
} from './types.js';

export class LocalParticipant extends EventEmitter {
  /** @internal */
  readonly _native: NativeLocalParticipant;

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

  get videoTracks(): TrackPublication[] {
    return this._native.videoTracks;
  }

  get audioTracks(): TrackPublication[] {
    return this._native.audioTracks;
  }

  get dataTracks(): TrackPublication[] {
    return this._native.dataTracks;
  }

  publishTrack(track: LocalVideoTrack | LocalAudioTrack | LocalDataTrack): boolean {
    return this._native.publishTrack(track);
  }

  unpublishTrack(track: LocalVideoTrack | LocalAudioTrack | LocalDataTrack): boolean {
    return this._native.unpublishTrack(track);
  }

  setEncodingParameters(params?: EncodingParameters): void {
    this._native.setEncodingParameters(params);
  }
}
