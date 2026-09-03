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
 * Track SID to its JS wrapper.
 *
 * The native layer mints a fresh JS object every time a track is surfaced - on
 * each `trackSubscribed` event and on every read of a participant's track
 * collections - so native object identity is not stable. The frame sink and the
 * policy queue live on the wrapper, so every path must resolve to the *same*
 * wrapper or a `frames()` loop would silently belong to a discarded object.
 * Keying by SID gives that stability; SIDs are unique per track.
 */
const registry = new Map<Track.SID, RemoteTrack>();

/**
 * Return the stable wrapper for a native remote track, creating it on first
 * sight. The first native object seen for a SID is the one the wrapper keeps,
 * because that is the instance its frame sink is attached to.
 */
export function wrapRemoteTrack(native: AnyNativeRemoteTrack): RemoteTrack {
  // A track with no SID cannot be keyed. Hand back an uncached wrapper rather
  // than colliding every such track onto one entry.
  const sid: Track.SID | undefined = native.sid;

  const existing = sid === undefined ? undefined : registry.get(sid);
  // A kind mismatch means the SID was reused or is not unique; the cached
  // wrapper is wrong for this track, so replace it rather than return a
  // video wrapper for an audio track.
  if (existing && existing.kind === native.kind) return existing;
  if (existing) {
    registry.delete(sid as Track.SID);
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
      throw new Error(`Unexpected remote track kind: ${String((native as { kind: string }).kind)}`);
  }
  if (sid !== undefined) registry.set(sid, wrapped);
  return wrapped;
}

/**
 * Look up a wrapper without creating one. Used when an unsubscribe arrives for
 * a track no consumer ever touched.
 */
export function peekRemoteTrack(sid: Track.SID): RemoteTrack | undefined {
  return registry.get(sid);
}

/**
 * End any active receiver on a track and forget it. Called on unsubscribe and
 * on Room teardown, so a `for await (const f of track.frames())` loop exits
 * instead of hanging forever.
 */
export function releaseRemoteTrack(sid: Track.SID): void {
  const wrapped = registry.get(sid);
  if (!wrapped) return;
  registry.delete(sid);
  wrapped._end();
}

/** Release every wrapper. Called from `Room.dispose()`. */
export function releaseAllRemoteTracks(): void {
  for (const wrapped of registry.values()) wrapped._end();
  registry.clear();
}
