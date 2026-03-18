import { EventEmitter } from 'node:events';
import { LocalParticipant } from './local_participant.js';
import { RemoteParticipant } from './remote_participant.js';
import type { NativeRoom, NativeRemoteParticipant, RoomState } from './types.js';

const PARTICIPANT_EVENTS = new Set([
  'participantConnected',
  'participantDisconnected',
  'participantReconnecting',
  'participantReconnected',
  'dominantSpeakerChanged',
]);

export class Room extends EventEmitter {
  /** @internal */
  readonly _native: NativeRoom;
  private _localParticipant: LocalParticipant | null = null;
  private _remoteParticipantCache = new Map<string, RemoteParticipant>();

  constructor(nativeRoom: NativeRoom) {
    super();
    this._native = nativeRoom;

    this._native.setEventCallback((event: string, data?: unknown) => {
      if (PARTICIPANT_EVENTS.has(event)) {
        const wrapped = data ? this._wrapRemoteParticipant(data as NativeRemoteParticipant) : null;
        this.emit(event, wrapped);
        if (event === 'participantDisconnected' && wrapped) {
          this._remoteParticipantCache.delete(wrapped.sid);
        }
      } else {
        this.emit(event, data);
      }
    });
  }

  get name(): string {
    return this._native.name;
  }

  get sid(): string {
    return this._native.sid;
  }

  get state(): RoomState {
    return this._native.state as RoomState;
  }

  get mediaRegion(): string {
    return this._native.mediaRegion;
  }

  get isRecording(): boolean {
    return this._native.isRecording;
  }

  get dominantSpeaker(): RemoteParticipant | null {
    const native = this._native.dominantSpeaker;
    if (!native) return null;
    return this._wrapRemoteParticipant(native);
  }

  get localParticipant(): LocalParticipant {
    if (!this._localParticipant) {
      this._localParticipant = new LocalParticipant(this._native.localParticipant);
    }
    return this._localParticipant;
  }

  get participants(): Map<string, RemoteParticipant> {
    const natives = this._native.remoteParticipants;
    const map = new Map<string, RemoteParticipant>();

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

  disconnect(): void {
    this._native.disconnect();
  }

  dispose(): void {
    this._native.dispose();
    this._localParticipant = null;
    this._remoteParticipantCache.clear();
    this.removeAllListeners();
  }

  private _wrapRemoteParticipant(native: NativeRemoteParticipant): RemoteParticipant {
    const sid = native.sid;
    let wrapped = this._remoteParticipantCache.get(sid);
    if (!wrapped) {
      wrapped = new RemoteParticipant(native);
      this._remoteParticipantCache.set(sid, wrapped);
    }
    return wrapped;
  }
}
