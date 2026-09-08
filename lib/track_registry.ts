import {
  RemoteAudioTrack,
  RemoteDataTrack,
  RemoteVideoTrack,
  type RemoteTrack,
} from './remote_track.js';
import type {
  NativeRemoteAudioTrack,
  NativeRemoteDataTrack,
  NativeRemoteVideoTrack,
  Track,
} from './types.js';

type AnyNativeRemoteTrack = NativeRemoteVideoTrack | NativeRemoteAudioTrack | NativeRemoteDataTrack;

/**
 * Track SID to its JS wrapper, scoped to one {@link Room}.
 *
 * The native layer mints a fresh JS object every time a track is surfaced - on
 * each `trackSubscribed` event and on every read of a participant's track
 * collections - so native object identity is not stable. The frame sink and the
 * policy queue live on the wrapper, so every path must resolve to the *same*
 * wrapper or a `frames()` loop would silently belong to a discarded object.
 * Keying by SID gives that stability; SIDs are unique per track.
 *
 * One registry per Room, never one per process. Two Rooms in the same process
 * can subscribe to the same publication, which carries the same Track SID in
 * both: a shared registry would hand them one wrapper, so only one of them
 * would receive that track's messages or frames. A process-wide registry also
 * made one Room's teardown end every other Room's receivers.
 */
export class TrackRegistry {
  private readonly registry = new Map<Track.SID, RemoteTrack>();

  /**
   * Return the stable wrapper for a native remote track, creating it on first
   * sight. The first native object seen for a SID is the one the wrapper keeps,
   * because that is the instance its frame sink is attached to.
   */
  wrapRemoteTrack(native: AnyNativeRemoteTrack): RemoteTrack {
    // A track with no SID cannot be keyed. Hand back an uncached wrapper rather
    // than colliding every such track onto one entry.
    const sid: Track.SID | undefined = native.sid;

    const existing = sid === undefined ? undefined : this.registry.get(sid);
    // A kind mismatch means the SID was reused or is not unique; the cached
    // wrapper is wrong for this track, so replace it rather than return a
    // video wrapper for an audio track.
    if (existing && existing.kind === native.kind) return existing;
    if (existing) {
      this.registry.delete(sid as Track.SID);
      existing._end();
    }

    let wrapped: RemoteTrack;
    switch (native.kind) {
      case 'video':
        wrapped = new RemoteVideoTrack(native as NativeRemoteVideoTrack);
        break;
      case 'audio':
        wrapped = new RemoteAudioTrack(native as NativeRemoteAudioTrack);
        break;
      case 'data':
        wrapped = new RemoteDataTrack(native as NativeRemoteDataTrack);
        break;
      default:
        throw new Error(
          `Unexpected remote track kind: ${String((native as { kind: string }).kind)}`,
        );
    }
    if (sid !== undefined) this.registry.set(sid, wrapped);
    return wrapped;
  }

  /**
   * Look up a wrapper without creating one. Used when an unsubscribe arrives
   * for a track no consumer ever touched.
   */
  peekRemoteTrack(sid: Track.SID): RemoteTrack | undefined {
    return this.registry.get(sid);
  }

  /**
   * End any active receiver on a track and forget it. Called on unsubscribe and
   * on Room teardown, so a `for await (const f of track.frames())` loop exits
   * instead of hanging forever.
   */
  releaseRemoteTrack(sid: Track.SID): void {
    const wrapped = this.registry.get(sid);
    if (!wrapped) return;
    this.registry.delete(sid);
    wrapped._end();
  }

  /** Release every wrapper this Room owns. Called from `Room.dispose()`. */
  releaseAllRemoteTracks(): void {
    for (const wrapped of this.registry.values()) wrapped._end();
    this.registry.clear();
  }
}
