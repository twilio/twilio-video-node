import { EventEmitter } from 'node:events';
import type { NativeRemoteParticipant, RemoteTrackPublication } from './types.js';

export class RemoteParticipant extends EventEmitter {
  /** @internal */
  readonly _native: NativeRemoteParticipant;

  constructor(nativeParticipant: NativeRemoteParticipant) {
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

  get videoTracks(): RemoteTrackPublication[] {
    return this._native.videoTracks;
  }

  get audioTracks(): RemoteTrackPublication[] {
    return this._native.audioTracks;
  }

  get dataTracks(): RemoteTrackPublication[] {
    return this._native.dataTracks;
  }
}
