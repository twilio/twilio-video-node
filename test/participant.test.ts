import { describe, it, expect, vi, afterEach } from 'vitest';
import { LocalParticipant } from '../lib/local_participant.js';
import { RemoteParticipant } from '../lib/remote_participant.js';
import {
  TrackPublication,
  LocalTrackPublication,
  LocalVideoTrackPublication,
  LocalAudioTrackPublication,
  LocalDataTrackPublication,
  RemoteTrackPublication,
  RemoteVideoTrackPublication,
} from '../lib/track_publication.js';
import { RemoteVideoTrack } from '../lib/remote_track.js';
import { releaseAllRemoteTracks } from '../lib/track_registry.js';
import { TwilioError } from '../lib/errors.js';
import type { LocalTrack } from '../lib/track_publication.js';
import type {
  NativeLocalParticipant,
  NativeRemoteParticipant,
  TrackPublication as RawTrackPublication,
} from '../lib/types.js';

type NativeCallback = (event: string, data?: unknown) => void;

function localTrack(name: string, kind: 'video' | 'audio' | 'data' = 'video'): LocalTrack {
  return { name, kind } as unknown as LocalTrack;
}

function rawPub(
  trackName: string,
  kind: 'video' | 'audio' | 'data',
  trackSid = `MT-${trackName}`,
): RawTrackPublication {
  return { trackSid, trackName, kind, isTrackEnabled: true };
}

function fakeNativeLocal(overrides: Partial<NativeLocalParticipant> = {}) {
  const p = {
    identity: 'alice',
    sid: 'PA-local',
    state: 'connected',
    networkQualityLevel: 4,
    signalingRegion: 'us1',
    videoTracks: [] as RawTrackPublication[],
    audioTracks: [] as RawTrackPublication[],
    dataTracks: [] as RawTrackPublication[],
    published: [] as LocalTrack[],
    unpublished: [] as LocalTrack[],
    publishTrack(t: LocalTrack) {
      p.published.push(t);
      return true;
    },
    unpublishTrack(t: LocalTrack) {
      p.unpublished.push(t);
      return true;
    },
    encodingParams: undefined as unknown,
    setEncodingParameters(params?: unknown) {
      p.encodingParams = params;
    },
    setEventCallback(cb: NativeCallback) {
      p.emit = cb;
    },
    emit: (() => {}) as NativeCallback,
    ...overrides,
  };
  return p as unknown as NativeLocalParticipant & {
    emit: NativeCallback;
    published: LocalTrack[];
    unpublished: LocalTrack[];
    encodingParams: unknown;
    videoTracks: RawTrackPublication[];
  };
}

function fakeNativeRemote() {
  const p = {
    identity: 'bob',
    sid: 'PA-bob',
    state: 'connected',
    networkQualityLevel: 3,
    videoTracks: [] as unknown[],
    audioTracks: [] as unknown[],
    dataTracks: [] as unknown[],
    setEventCallback(cb: NativeCallback) {
      p.emit = cb;
    },
    emit: (() => {}) as NativeCallback,
  };
  return p as unknown as NativeRemoteParticipant & { emit: NativeCallback; videoTracks: unknown[] };
}

afterEach(() => releaseAllRemoteTracks());

describe('TrackPublication', () => {
  it('snapshots the raw publication fields', () => {
    const pub = new TrackPublication(rawPub('cam', 'video'));
    expect(pub.trackSid).toBe('MT-cam');
    expect(pub.trackName).toBe('cam');
    expect(pub.kind).toBe('video');
    expect(pub.isTrackEnabled).toBe(true);
  });
});

describe('LocalTrackPublication.unpublish', () => {
  it('invokes the injected callback with the track and returns itself', () => {
    const track = localTrack('cam');
    const unpublish = vi.fn(() => true);
    const pub = new LocalTrackPublication(rawPub('cam', 'video'), track, unpublish);

    expect(pub.unpublish()).toBe(pub);
    expect(unpublish).toHaveBeenCalledWith(track);
  });

  it('is idempotent', () => {
    const unpublish = vi.fn(() => true);
    const pub = new LocalTrackPublication(rawPub('cam', 'video'), localTrack('cam'), unpublish);
    pub.unpublish();
    pub.unpublish();
    expect(unpublish).toHaveBeenCalledTimes(1);
  });

  it('keeps the track readable after unpublishing', () => {
    const track = localTrack('cam');
    const pub = new LocalTrackPublication(rawPub('cam', 'video'), track, () => true);
    pub.unpublish();
    expect(pub.track).toBe(track);
  });

  it('is a no-op without a callback or without a track', () => {
    expect(() => new LocalTrackPublication(rawPub('a', 'video')).unpublish()).not.toThrow();
    const noTrack = new LocalTrackPublication(rawPub('a', 'video'), null, () => true);
    expect(() => noTrack.unpublish()).not.toThrow();
  });

  it('narrows by kind through the subclasses', () => {
    expect(new LocalVideoTrackPublication(rawPub('c', 'video'))).toBeInstanceOf(
      LocalTrackPublication,
    );
    expect(new LocalAudioTrackPublication(rawPub('m', 'audio'))).toBeInstanceOf(
      LocalTrackPublication,
    );
    expect(new LocalDataTrackPublication(rawPub('d', 'data'))).toBeInstanceOf(
      LocalTrackPublication,
    );
  });
});

describe('RemoteTrackPublication', () => {
  it('reports subscription state and leaves track undefined when unsubscribed', () => {
    const pub = new RemoteTrackPublication({ ...rawPub('cam', 'video'), isSubscribed: false });
    expect(pub.isSubscribed).toBe(false);
    expect(pub.track).toBeUndefined();
  });

  it('resolves a subscribed track through the registry, so identity is stable', () => {
    const nativeTrack = {
      name: 'cam',
      kind: 'video' as const,
      sid: 'MT-shared',
      enabled: true,
      isSwitchedOff: false,
      _attachFrameSink() {},
      _detachFrameSink() {},
      _sinkStats: () => ({ nativeDropped: 0, nativeQueueDepth: 0 }),
      setContentPreferences() {},
    };
    const raw = { ...rawPub('cam', 'video', 'MT-shared'), isSubscribed: true, track: nativeTrack };

    const a = new RemoteVideoTrackPublication(raw as never);
    const b = new RemoteVideoTrackPublication(raw as never);
    expect(a.track).toBeInstanceOf(RemoteVideoTrack);
    // Two publications built from the same native track must hand back one
    // wrapper, or a frames() loop would belong to a discarded object.
    expect(a.track).toBe(b.track);
  });
});

describe('LocalParticipant', () => {
  it('reads through to the native participant', () => {
    const p = new LocalParticipant(fakeNativeLocal());
    expect(p.identity).toBe('alice');
    expect(p.sid).toBe('PA-local');
    expect(p.state).toBe('connected');
    expect(p.networkQualityLevel).toBe(4);
    expect(p.signalingRegion).toBe('us1');
  });

  it('publishes and unpublishes, delegating to native', () => {
    const native = fakeNativeLocal();
    const p = new LocalParticipant(native);
    const track = localTrack('cam');

    expect(p.publishTrack(track)).toBe(true);
    expect(native.published).toEqual([track]);
    expect(p.unpublishTrack(track)).toBe(true);
    expect(native.unpublished).toEqual([track]);
  });

  it('rejects a second, different track published under the same name', () => {
    const p = new LocalParticipant(fakeNativeLocal());
    p.publishTrack(localTrack('cam'));
    expect(() => p.publishTrack(localTrack('cam'))).toThrow(/must be unique/);
  });

  it('allows re-publishing the same track instance', () => {
    const p = new LocalParticipant(fakeNativeLocal());
    const track = localTrack('cam');
    p.publishTrack(track);
    expect(() => p.publishTrack(track)).not.toThrow();
  });

  it('publishes and unpublishes in batches, index-aligned', () => {
    const native = fakeNativeLocal();
    const p = new LocalParticipant(native);
    const tracks = [localTrack('a'), localTrack('b')];

    expect(p.publishTracks(tracks)).toEqual([true, true]);
    expect(p.unpublishTracks(tracks)).toEqual([true, true]);
  });

  it('seeds tracks supplied at connect', () => {
    const native = fakeNativeLocal();
    const seeded = localTrack('seeded');
    native.videoTracks.push(rawPub('seeded', 'video'));
    const p = new LocalParticipant(native, [seeded]);

    expect(p.videoTracks.get('MT-seeded')?.track).toBe(seeded);
  });

  it('builds per-kind maps and a merged map keyed by SID', () => {
    const native = fakeNativeLocal();
    native.videoTracks.push(rawPub('cam', 'video'));
    (native as unknown as { audioTracks: RawTrackPublication[] }).audioTracks.push(
      rawPub('mic', 'audio'),
    );
    (native as unknown as { dataTracks: RawTrackPublication[] }).dataTracks.push(
      rawPub('chat', 'data'),
    );
    const p = new LocalParticipant(native);

    expect(p.videoTracks.size).toBe(1);
    expect(p.audioTracks.size).toBe(1);
    expect(p.dataTracks.size).toBe(1);
    expect(p.tracks.size).toBe(3);
    expect(p.tracks.get('MT-cam')).toBeInstanceOf(LocalVideoTrackPublication);
  });

  it('emits trackPublished with a resolved publication', () => {
    const native = fakeNativeLocal();
    const p = new LocalParticipant(native);
    const track = localTrack('cam');
    p.publishTrack(track);

    const seen: LocalTrackPublication[] = [];
    p.on('trackPublished', pub => seen.push(pub));
    native.emit('trackPublished', rawPub('cam', 'video'));

    expect(seen).toHaveLength(1);
    expect(seen[0].track).toBe(track);
  });

  it('ignores a trackPublished payload with no SID', () => {
    const native = fakeNativeLocal();
    const p = new LocalParticipant(native);
    const seen: unknown[] = [];
    p.on('trackPublished', pub => seen.push(pub));
    native.emit('trackPublished', undefined);
    expect(seen).toHaveLength(0);
  });

  it('throws on an unexpected track kind in a publication payload', () => {
    const native = fakeNativeLocal();
    new LocalParticipant(native);
    expect(() => native.emit('trackPublished', rawPub('x', 'haptic' as never))).toThrow(
      /Unexpected track kind/,
    );
  });

  it('frees the name for re-publish when publication fails', () => {
    const native = fakeNativeLocal();
    const p = new LocalParticipant(native);
    p.publishTrack(localTrack('cam'));

    const errors: TwilioError[] = [];
    p.on('trackPublicationFailed', e => errors.push(e));
    native.emit('trackPublicationFailed', { code: 53300, trackName: 'cam' });

    expect(errors[0]).toBeInstanceOf(TwilioError);
    // The name is free again, so a different instance can take it.
    expect(() => p.publishTrack(localTrack('cam'))).not.toThrow();
  });

  it('handles a publication-failed payload with no track name', () => {
    const native = fakeNativeLocal();
    const p = new LocalParticipant(native);
    const errors: TwilioError[] = [];
    p.on('trackPublicationFailed', e => errors.push(e));

    native.emit('trackPublicationFailed', { code: 53300 });
    expect(errors).toHaveLength(1);
  });

  it('resolves a publication for a track it does not know, with a null track', () => {
    const native = fakeNativeLocal();
    const p = new LocalParticipant(native);
    const seen: LocalTrackPublication[] = [];
    p.on('trackPublished', pub => seen.push(pub));

    // A publication arriving for a name that was never published locally must
    // still surface, rather than being dropped - for every kind.
    native.emit('trackPublished', rawPub('unknown-v', 'video'));
    native.emit('trackPublished', rawPub('unknown-a', 'audio'));
    native.emit('trackPublished', rawPub('unknown-d', 'data'));

    expect(seen).toHaveLength(3);
    expect(seen.map(p => p.track)).toEqual([null, null, null]);
    expect(seen[0]).toBeInstanceOf(LocalVideoTrackPublication);
    expect(seen[1]).toBeInstanceOf(LocalAudioTrackPublication);
    expect(seen[2]).toBeInstanceOf(LocalDataTrackPublication);
  });

  it('reports false from unpublishTrack when native declines', () => {
    const native = fakeNativeLocal({ unpublishTrack: () => false } as never);
    const p = new LocalParticipant(native);
    expect(p.unpublishTrack(localTrack('cam'))).toBe(false);
  });

  it('does not record a track when native declines the publish', () => {
    const native = fakeNativeLocal({ publishTrack: () => false } as never);
    const p = new LocalParticipant(native);
    expect(p.publishTrack(localTrack('cam'))).toBe(false);
    // The name stays free, since nothing was published.
    expect(() => p.publishTrack(localTrack('cam'))).not.toThrow();
  });

  it('forwards encoding parameters', () => {
    const native = fakeNativeLocal();
    new LocalParticipant(native).setEncodingParameters({ maxVideoBitrate: 500_000 });
    expect(native.encodingParams).toEqual({ maxVideoBitrate: 500_000 });
  });

  it('dispose clears listeners and published tracks', () => {
    const native = fakeNativeLocal();
    const p = new LocalParticipant(native);
    p.publishTrack(localTrack('cam'));
    p.on('trackPublished', () => {});

    p.dispose();
    expect(p.listenerCount('trackPublished')).toBe(0);
  });
});

describe('TypedEventEmitter overrides', () => {
  it('supports once, off, addListener and removeListener', () => {
    const p = new RemoteParticipant(fakeNativeRemote());
    const calls: number[] = [];
    const listener = () => calls.push(1);

    p.addListener('trackPublished', listener);
    expect(p.listenerCount('trackPublished')).toBe(1);
    p.off('trackPublished', listener);
    expect(p.listenerCount('trackPublished')).toBe(0);

    p.on('trackPublished', listener);
    p.removeListener('trackPublished', listener);
    expect(p.listenerCount('trackPublished')).toBe(0);

    p.once('trackPublished', listener);
    expect(p.listenerCount('trackPublished')).toBe(1);
  });
});

describe('LocalParticipant publication resolution', () => {
  it.each([
    ['audio', LocalAudioTrackPublication],
    ['data', LocalDataTrackPublication],
  ] as const)('resolves a %s publication to the right class', (kind, Cls) => {
    const native = fakeNativeLocal();
    const p = new LocalParticipant(native);
    const track = localTrack('t', kind);
    p.publishTrack(track);

    const seen: LocalTrackPublication[] = [];
    p.on('trackPublished', pub => seen.push(pub));
    native.emit('trackPublished', rawPub('t', kind));

    expect(seen[0]).toBeInstanceOf(Cls);
    expect(seen[0].track).toBe(track);
  });

  it('passes non-publication events straight through', () => {
    const native = fakeNativeLocal();
    const p = new LocalParticipant(native);
    const seen: unknown[] = [];
    p.on('networkQualityLevelChanged', level => seen.push(level));
    native.emit('networkQualityLevelChanged', 5);
    expect(seen).toEqual([5]);
  });

  it('unpublishes through the publication returned by the track maps', () => {
    const native = fakeNativeLocal();
    native.videoTracks.push(rawPub('cam', 'video'));
    const track = localTrack('cam');
    const p = new LocalParticipant(native, [track]);

    p.videoTracks.get('MT-cam')?.unpublish();
    expect(native.unpublished).toEqual([track]);
  });
});

describe('RemoteParticipant', () => {
  it('reads through to the native participant', () => {
    const p = new RemoteParticipant(fakeNativeRemote());
    expect(p.identity).toBe('bob');
    expect(p.sid).toBe('PA-bob');
    expect(p.state).toBe('connected');
    expect(p.networkQualityLevel).toBe(3);
  });

  it('lifts a trackSubscriptionFailed payload', () => {
    const native = fakeNativeRemote();
    const p = new RemoteParticipant(native);
    const seen: Array<[TwilioError, unknown]> = [];
    p.on('trackSubscriptionFailed', (e, pub) => seen.push([e, pub]));

    native.emit('trackSubscriptionFailed', {
      error: { code: 53404 },
      publication: { trackSid: 'MT-x', trackName: 'x', kind: 'video' },
    });

    expect(seen[0][0]).toBeInstanceOf(TwilioError);
    expect(seen[0][0].code).toBe(53404);
    expect(seen[0][1]).toMatchObject({ trackSid: 'MT-x' });
  });

  it('tolerates a trackSubscriptionFailed payload with nothing in it', () => {
    const native = fakeNativeRemote();
    const p = new RemoteParticipant(native);
    const seen: unknown[] = [];
    p.on('trackSubscriptionFailed', e => seen.push(e));
    native.emit('trackSubscriptionFailed', undefined);
    expect(seen).toHaveLength(1);
  });

  it('passes through publication-shaped events untouched', () => {
    const native = fakeNativeRemote();
    const p = new RemoteParticipant(native);
    const seen: unknown[] = [];
    p.on('trackPublished', pub => seen.push(pub));
    native.emit('trackPublished', { trackSid: 'MT-y', trackName: 'y' });
    expect(seen).toEqual([{ trackSid: 'MT-y', trackName: 'y' }]);
  });

  it('builds per-kind publication maps for all three kinds', () => {
    const native = fakeNativeRemote();
    native.videoTracks.push({ ...rawPub('cam', 'video'), isSubscribed: false });
    (native as unknown as { audioTracks: unknown[] }).audioTracks.push({
      ...rawPub('mic', 'audio'),
      isSubscribed: false,
    });
    (native as unknown as { dataTracks: unknown[] }).dataTracks.push({
      ...rawPub('chat', 'data'),
      isSubscribed: false,
    });
    const p = new RemoteParticipant(native);

    expect(p.videoTracks.size).toBe(1);
    expect(p.audioTracks.size).toBe(1);
    expect(p.dataTracks.size).toBe(1);
    expect(p.tracks.size).toBe(3);
    expect(p.tracks.get('MT-cam')).toBeInstanceOf(RemoteTrackPublication);
  });

  it('dispose clears listeners', () => {
    const p = new RemoteParticipant(fakeNativeRemote());
    p.on('trackPublished', () => {});
    p.dispose();
    expect(p.listenerCount('trackPublished')).toBe(0);
  });
});
