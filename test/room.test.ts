import { describe, it, expect, vi, afterEach } from 'vitest';
import { Room } from '../lib/room.js';
import { RemoteParticipant } from '../lib/remote_participant.js';
import { LocalParticipant } from '../lib/local_participant.js';
import { RemoteVideoTrack } from '../lib/remote_track.js';
import { releaseAllRemoteTracks, peekRemoteTrack } from '../lib/track_registry.js';
import { TwilioError } from '../lib/errors.js';
import type {
  NativeLocalParticipant,
  NativeRemoteParticipant,
  NativeRoom,
  StatsReport,
} from '../lib/types.js';

type NativeCallback = (event: string, data?: unknown) => void;

function fakeNativeVideoTrack(sid = 'MT-v') {
  const t = {
    name: 'cam',
    kind: 'video' as const,
    sid,
    enabled: true,
    isSwitchedOff: false,
    detached: 0,
    _attachFrameSink() {},
    _detachFrameSink() {
      t.detached++;
    },
    _sinkStats: () => ({ nativeDropped: 0, nativeQueueDepth: 0 }),
    setContentPreferences() {},
  };
  return t;
}

function fakeLocalParticipant(): NativeLocalParticipant & { emit: NativeCallback } {
  const p = {
    identity: 'alice',
    sid: 'PA-local',
    state: 'connected',
    networkQualityLevel: null,
    signalingRegion: 'us1',
    videoTracks: [],
    audioTracks: [],
    dataTracks: [],
    publishTrack: () => true,
    unpublishTrack: () => true,
    setEncodingParameters() {},
    setEventCallback(cb: NativeCallback) {
      p.emit = cb;
    },
    emit: (() => {}) as NativeCallback,
  } as unknown as NativeLocalParticipant & { emit: NativeCallback };
  return p;
}

function fakeRemoteParticipant(sid = 'PA-1', identity = 'bob') {
  const p = {
    identity,
    sid,
    state: 'connected',
    networkQualityLevel: null,
    videoTracks: [],
    audioTracks: [],
    dataTracks: [],
    setEventCallback(cb: NativeCallback) {
      p.emit = cb;
    },
    emit: (() => {}) as NativeCallback,
  };
  return p as unknown as NativeRemoteParticipant & { emit: NativeCallback };
}

function fakeRoom(
  remotes: Array<NativeRemoteParticipant & { emit: NativeCallback }> = [],
  overrides: Partial<NativeRoom> = {},
) {
  const local = fakeLocalParticipant();
  const native = {
    name: 'room-1',
    sid: 'RM-1',
    state: 'connected',
    mediaRegion: 'us1',
    isRecording: false,
    localParticipant: local,
    dominantSpeaker: null,
    remoteParticipants: remotes,
    disconnected: 0,
    disposed: 0,
    disconnect() {
      native.disconnected++;
    },
    dispose() {
      native.disposed++;
    },
    setEventCallback(cb: NativeCallback) {
      native.emit = cb;
    },
    getStats(cb: (e: Error | null, r: StatsReport[]) => void) {
      cb(null, []);
    },
    emit: (() => {}) as NativeCallback,
    ...overrides,
  };
  return native as unknown as NativeRoom & {
    emit: NativeCallback;
    disposed: number;
    disconnected: number;
  };
}

afterEach(() => releaseAllRemoteTracks());

describe('Room properties', () => {
  it('reads through to the native room', () => {
    const native = fakeRoom();
    const room = new Room(native);
    expect(room.name).toBe('room-1');
    expect(room.sid).toBe('RM-1');
    expect(room.state).toBe('connected');
    expect(room.mediaRegion).toBe('us1');
    expect(room.isRecording).toBe(false);
  });

  it('lazily creates and caches the local participant', () => {
    const room = new Room(fakeRoom());
    const first = room.localParticipant;
    expect(first).toBeInstanceOf(LocalParticipant);
    expect(room.localParticipant).toBe(first);
  });

  it('returns null dominantSpeaker when there is none', () => {
    expect(new Room(fakeRoom()).dominantSpeaker).toBeNull();
  });

  it('wraps dominantSpeaker when present', () => {
    const bob = fakeRemoteParticipant();
    const room = new Room(fakeRoom([bob], { dominantSpeaker: bob } as Partial<NativeRoom>));
    expect(room.dominantSpeaker).toBeInstanceOf(RemoteParticipant);
    expect(room.dominantSpeaker?.identity).toBe('bob');
  });
});

describe('Room participants', () => {
  it('exposes remote participants keyed by SID, with stable wrappers', () => {
    const bob = fakeRemoteParticipant('PA-bob', 'bob');
    const room = new Room(fakeRoom([bob]));

    const first = room.participants;
    expect(first.size).toBe(1);
    expect(first.get('PA-bob')).toBeInstanceOf(RemoteParticipant);
    // A fresh Map each read, but the same wrapper instances.
    expect(room.participants).not.toBe(first);
    expect(room.participants.get('PA-bob')).toBe(first.get('PA-bob'));
  });

  it('evicts wrappers for participants who are gone', () => {
    const bob = fakeRemoteParticipant('PA-bob');
    const native = fakeRoom([bob]);
    const room = new Room(native);
    // Read once to populate the wrapper cache.
    expect(room.participants.size).toBe(1);

    (native as unknown as { remoteParticipants: unknown[] }).remoteParticipants = [];
    expect(room.participants.size).toBe(0);
  });

  it('remoteParticipants returns the same set as participants', () => {
    const room = new Room(fakeRoom([fakeRemoteParticipant('PA-bob')]));
    expect(room.remoteParticipants.map(p => p.sid)).toEqual(['PA-bob']);
  });
});

describe('Room lifecycle events', () => {
  it('seeds existing participants on connected and fires the callback once', () => {
    const bob = fakeRemoteParticipant('PA-bob');
    const native = fakeRoom([bob]);
    const onConnected = vi.fn();
    new Room(native, [], onConnected);

    native.emit('connected');
    native.emit('connected');
    expect(onConnected).toHaveBeenCalledTimes(1);
  });

  it('lifts a connectFailure payload into a TwilioError', () => {
    const native = fakeRoom();
    const room = new Room(native);
    const seen: unknown[] = [];
    room.on('connectFailure', e => seen.push(e));

    native.emit('connectFailure', { code: 53106 });
    expect(seen[0]).toBeInstanceOf(TwilioError);
    expect((seen[0] as TwilioError).code).toBe(53106);
  });

  it('emits disconnected with an error, or without one', () => {
    const native = fakeRoom();
    const room = new Room(native);
    const seen: unknown[] = [];
    room.on('disconnected', e => seen.push(e));

    native.emit('disconnected');
    native.emit('disconnected', { code: 53118 });
    expect(seen[0]).toBeUndefined();
    expect(seen[1]).toBeInstanceOf(TwilioError);
  });

  it('ends active frame receivers when the Room disconnects', async () => {
    const bob = fakeRemoteParticipant('PA-bob');
    const native = fakeRoom([bob]);
    const room = new Room(native);
    native.emit('connected');

    const nativeTrack = fakeNativeVideoTrack('MT-live');
    const subscribed = new Promise<RemoteVideoTrack>(resolve =>
      room.once('trackSubscribed', t => resolve(t as RemoteVideoTrack)),
    );
    bob.emit('trackSubscribed', nativeTrack);
    const track = await subscribed;

    const iterator = track.frames();
    let ended = false;
    const loop = (async () => {
      for await (const _f of iterator) void _f;
      ended = true;
    })();

    // A disconnect must complete the iterator; otherwise the loop hangs on a
    // Room that will never produce another frame.
    native.emit('disconnected');
    await loop;
    expect(ended).toBe(true);
    expect(nativeTrack.detached).toBe(1);
  });

  it('emits participantConnected and disposes the wrapper on disconnect', () => {
    const bob = fakeRemoteParticipant('PA-bob');
    const native = fakeRoom([bob]);
    const room = new Room(native);

    const connected: RemoteParticipant[] = [];
    room.on('participantConnected', p => connected.push(p));
    native.emit('participantConnected', bob);
    expect(connected).toHaveLength(1);

    room.on('participantDisconnected', p => expect(p.sid).toBe('PA-bob'));
    native.emit('participantDisconnected', bob);
    // Evicted from the cache, so a later read builds a fresh wrapper.
    expect(room.participants.get('PA-bob')).not.toBe(connected[0]);
  });

  it('emits dominantSpeakerChanged with null when nobody is speaking', () => {
    const native = fakeRoom();
    const room = new Room(native);
    const seen: unknown[] = [];
    room.on('dominantSpeakerChanged', p => seen.push(p));
    native.emit('dominantSpeakerChanged', undefined);
    expect(seen).toEqual([null]);
  });

  it('emits reconnecting with and without an error', () => {
    const native = fakeRoom();
    const room = new Room(native);
    const seen: unknown[] = [];
    room.on('reconnecting', e => seen.push(e));

    native.emit('reconnecting');
    native.emit('reconnecting', { code: 53001 });
    expect(seen[0]).toBeUndefined();
    expect(seen[1]).toBeInstanceOf(TwilioError);
  });

  it('passes through events it does not special-case', () => {
    const native = fakeRoom();
    const room = new Room(native);
    const seen: unknown[] = [];
    room.on('transcription', t => seen.push(t));
    native.emit('transcription', '{"type":"x"}');
    expect(seen).toEqual(['{"type":"x"}']);
  });
});

describe('Room track event bubbling', () => {
  it('re-emits a participant track event with the participant appended', async () => {
    const bob = fakeRemoteParticipant('PA-bob');
    const native = fakeRoom([bob]);
    const room = new Room(native);
    native.emit('connected');

    const seen: Array<[unknown, unknown]> = [];
    room.on('trackSubscribed', (track, participant) => seen.push([track, participant]));

    bob.emit('trackSubscribed', fakeNativeVideoTrack('MT-bubble'));

    expect(seen).toHaveLength(1);
    expect(seen[0][0]).toBeInstanceOf(RemoteVideoTrack);
    expect((seen[0][1] as RemoteParticipant).sid).toBe('PA-bob');
  });

  it('releases the track wrapper on unsubscribe', () => {
    const bob = fakeRemoteParticipant('PA-bob');
    const native = fakeRoom([bob]);
    const room = new Room(native);
    native.emit('connected');
    room.on('trackSubscribed', () => {});

    bob.emit('trackSubscribed', fakeNativeVideoTrack('MT-gone'));
    expect(peekRemoteTrack('MT-gone')).toBeDefined();

    bob.emit('trackUnsubscribed', fakeNativeVideoTrack('MT-gone'));
    expect(peekRemoteTrack('MT-gone')).toBeUndefined();
  });
});

describe('Room.getStats', () => {
  it('resolves with the native reports', async () => {
    const room = new Room(fakeRoom());
    await expect(room.getStats()).resolves.toEqual([]);
  });

  it('rejects once disconnected', async () => {
    const room = new Room(fakeRoom([], { state: 'disconnected' } as Partial<NativeRoom>));
    await expect(room.getStats()).rejects.toThrow(/disconnected/);
  });

  it('rejects when the native call reports an error', async () => {
    const native = fakeRoom([], {
      getStats(cb: (e: Error | null, r: StatsReport[]) => void) {
        cb(new Error('stats failed'), []);
      },
    } as Partial<NativeRoom>);
    await expect(new Room(native).getStats()).rejects.toThrow('stats failed');
  });
});

describe('Room teardown', () => {
  it('disconnect delegates without disposing', () => {
    const native = fakeRoom();
    new Room(native).disconnect();
    expect(native.disconnected).toBe(1);
    expect(native.disposed).toBe(0);
  });

  it('dispose releases the native room, wrappers and listeners', () => {
    const bob = fakeRemoteParticipant('PA-bob');
    const native = fakeRoom([bob]);
    const room = new Room(native);
    native.emit('connected');
    // Touch the lazy getter so dispose() has something to tear down.
    expect(room.localParticipant).toBeDefined();
    room.on('disconnected', () => {});

    room.dispose();

    expect(native.disposed).toBe(1);
    expect(room.listenerCount('disconnected')).toBe(0);
  });

  it('dispose ends active frame receivers', async () => {
    const bob = fakeRemoteParticipant('PA-bob');
    const native = fakeRoom([bob]);
    const room = new Room(native);
    native.emit('connected');
    room.on('trackSubscribed', () => {});

    const nativeTrack = fakeNativeVideoTrack('MT-dispose');
    bob.emit('trackSubscribed', nativeTrack);
    const track = peekRemoteTrack('MT-dispose') as RemoteVideoTrack;
    const iterator = track.frames();

    room.dispose();

    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
    expect(nativeTrack.detached).toBe(1);
  });
});
