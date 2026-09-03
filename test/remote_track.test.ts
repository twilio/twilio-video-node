import { describe, it, expect, vi, afterEach } from 'vitest';
import { RemoteVideoTrack, RemoteAudioTrack, RemoteDataTrack } from '../lib/remote_track.js';
import {
  wrapRemoteTrack,
  peekRemoteTrack,
  releaseRemoteTrack,
  releaseAllRemoteTracks,
} from '../lib/track_registry.js';
import type { AudioFrame, VideoFrame } from '../lib/types.js';

/**
 * Stand-in for the native track wrap. Records sink attach/detach so tests can
 * assert the JS layer releases the native sink, and exposes `emit` to play the
 * role of the decoder delivering a frame.
 */
function fakeNativeVideo(sid = 'MT-video') {
  const native = {
    name: 'cam',
    kind: 'video' as const,
    sid,
    enabled: true,
    isSwitchedOff: false,
    attached: 0,
    detached: 0,
    lastDepth: undefined as number | undefined,
    emit: undefined as ((f: VideoFrame) => void) | undefined,
    nativeDropped: 0,
    nativeQueueDepth: 0,
    prefs: undefined as unknown,
    _attachFrameSink(cb: (f: VideoFrame) => void, depth?: number) {
      native.attached++;
      native.lastDepth = depth;
      native.emit = cb;
    },
    _detachFrameSink() {
      native.detached++;
      native.emit = undefined;
    },
    _sinkStats() {
      return { nativeDropped: native.nativeDropped, nativeQueueDepth: native.nativeQueueDepth };
    },
    setContentPreferences(p: unknown) {
      native.prefs = p;
    },
  };
  return native;
}

function fakeNativeAudio(sid = 'MT-audio') {
  const native = {
    name: 'mic',
    kind: 'audio' as const,
    sid,
    enabled: true,
    emit: undefined as ((f: AudioFrame) => void) | undefined,
    _attachFrameSink(cb: (f: AudioFrame) => void) {
      native.emit = cb;
    },
    _detachFrameSink() {
      native.emit = undefined;
    },
    _sinkStats() {
      return { nativeDropped: 0, nativeQueueDepth: 0 };
    },
  };
  return native;
}

function fakeNativeData(sid = 'MT-data') {
  const native = {
    name: 'chat',
    kind: 'data' as const,
    sid,
    maxPacketLifeTime: null,
    maxRetransmits: null,
    reliable: true,
    ordered: true,
    emit: undefined as ((d: string | Buffer) => void) | undefined,
    removed: 0,
    onMessage(cb: (d: string | Buffer) => void) {
      native.emit = cb;
    },
    removeMessageCallback() {
      native.removed++;
      native.emit = undefined;
    },
  };
  return native;
}

function videoFrame(id: number): VideoFrame {
  const plane = (n: number) => ({ data: Buffer.alloc(n, 1), stride: 2, width: 2, height: 2 });
  return {
    format: 'I420',
    width: 2,
    height: 2,
    y: plane(4),
    u: plane(1),
    v: plane(1),
    timestamp: id * 1000,
    frameId: id,
  } as VideoFrame;
}

afterEach(() => releaseAllRemoteTracks());

describe('RemoteVideoTrack properties', () => {
  it('reads through to the native track', () => {
    const native = fakeNativeVideo();
    const track = new RemoteVideoTrack(native as never);
    expect(track.name).toBe('cam');
    expect(track.sid).toBe('MT-video');
    expect(track.kind).toBe('video');
    expect(track.enabled).toBe(true);
    expect(track.isSwitchedOff).toBe(false);
  });

  it('forwards content preferences', () => {
    const native = fakeNativeVideo();
    const track = new RemoteVideoTrack(native as never);
    track.setContentPreferences({ renderDimensions: { width: 320, height: 240 } });
    expect(native.prefs).toEqual({ renderDimensions: { width: 320, height: 240 } });
  });
});

describe('RemoteVideoTrack.frames', () => {
  it('attaches a native sink bounded by the resolved maxQueue', () => {
    const native = fakeNativeVideo();
    const track = new RemoteVideoTrack(native as never);
    track.frames();
    expect(native.attached).toBe(1);
    // Video defaults to 'latest'/1, so native holds at most one ~1.3MB frame.
    expect(native.lastDepth).toBe(1);
  });

  it('passes an explicit maxQueue down to the native sink', () => {
    const native = fakeNativeVideo();
    const track = new RemoteVideoTrack(native as never);
    track.frames({ mode: 'queue', maxQueue: 8 });
    expect(native.lastDepth).toBe(8);
  });

  it('enforces a single receiver per track', () => {
    const track = new RemoteVideoTrack(fakeNativeVideo() as never);
    track.frames();
    expect(() => track.frames()).toThrow(/single receiver/);
  });

  it('allows a new receiver once the previous one ends', () => {
    const native = fakeNativeVideo();
    const track = new RemoteVideoTrack(native as never);
    const first = track.frames();
    void first.return?.();
    expect(() => track.frames()).not.toThrow();
    expect(native.detached).toBe(1);
  });

  it('propagates option validation errors', () => {
    const track = new RemoteVideoTrack(fakeNativeVideo() as never);
    expect(() => track.frames({ mode: 'bogus' as never })).toThrow(TypeError);
    expect(() => track.frames({ maxQueue: 0 })).toThrow(RangeError);
  });

  it('delivers frames pushed by the native sink', async () => {
    const native = fakeNativeVideo();
    const track = new RemoteVideoTrack(native as never);
    const it = track.frames({ mode: 'queue', maxQueue: 4 });

    native.emit?.(videoFrame(1));
    native.emit?.(videoFrame(2));

    expect(((await it.next()).value as VideoFrame).frameId).toBe(1);
    expect(((await it.next()).value as VideoFrame).frameId).toBe(2);
  });

  it('detaches the native sink when the consumer breaks out', async () => {
    const native = fakeNativeVideo();
    const track = new RemoteVideoTrack(native as never);
    const it = track.frames({ mode: 'queue', maxQueue: 4 });
    native.emit?.(videoFrame(1));

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _frame of it) break;
    expect(native.detached).toBe(1);
  });

  it('detaches only once when the consumer ends twice', async () => {
    const native = fakeNativeVideo();
    const track = new RemoteVideoTrack(native as never);
    const it = track.frames();
    await it.return?.();
    await it.return?.();
    expect(native.detached).toBe(1);
  });

  it('a superseded stream ending does not detach the current receiver', async () => {
    const native = fakeNativeVideo();
    const track = new RemoteVideoTrack(native as never);
    const first = track.frames();
    await first.return?.();
    // A new receiver is now the live one.
    track.frames();
    // Ending the stale iterator again must not tear down the new sink.
    await first.return?.();
    expect(native.detached).toBe(1);
    expect(native.attached).toBe(2);
  });

  it('survives a native detach that throws because the Room already ended', () => {
    const native = fakeNativeVideo();
    native._detachFrameSink = () => {
      throw new Error('native track gone');
    };
    const track = new RemoteVideoTrack(native as never);
    const it = track.frames();
    expect(() => void it.return?.()).not.toThrow();
  });

  it('_end ends an in-flight iterator so a for-await loop exits', async () => {
    const native = fakeNativeVideo();
    const track = new RemoteVideoTrack(native as never);
    const it = track.frames();

    const seen: number[] = [];
    const loop = (async () => {
      for await (const f of it) seen.push(f.frameId);
    })();

    native.emit?.(videoFrame(1));
    await new Promise(r => setTimeout(r, 10));
    track._end();
    await loop;

    expect(seen).toEqual([1]);
  });

  it('_end is safe when no receiver was ever started', () => {
    const track = new RemoteVideoTrack(fakeNativeVideo() as never);
    expect(() => track._end()).not.toThrow();
  });
});

describe('RemoteVideoTrack.getStats', () => {
  it('reports zeros before any receiver starts', () => {
    const track = new RemoteVideoTrack(fakeNativeVideo() as never);
    expect(track.getStats()).toEqual({
      framesDelivered: 0,
      framesDropped: 0,
      queueDepth: 0,
      maxQueue: 0,
    });
  });

  it('reports live numbers while a receiver is active', async () => {
    const native = fakeNativeVideo();
    const track = new RemoteVideoTrack(native as never);
    const it = track.frames({ mode: 'queue', maxQueue: 4 });
    native.emit?.(videoFrame(1));
    await it.next();

    expect(track.getStats()).toMatchObject({ framesDelivered: 1, lastTimestamp: 1000 });
  });

  it('folds native transfer-queue drops into the total', () => {
    const native = fakeNativeVideo();
    native.nativeDropped = 4;
    const track = new RemoteVideoTrack(native as never);
    track.frames({ mode: 'latest', maxQueue: 1 });

    native.emit?.(videoFrame(1));
    native.emit?.(videoFrame(2)); // one JS-side drop

    expect(track.getStats().framesDropped).toBe(5);
  });

  it('keeps the final numbers readable after the receiver ends', async () => {
    const native = fakeNativeVideo();
    const track = new RemoteVideoTrack(native as never);
    const it = track.frames({ mode: 'queue', maxQueue: 4 });
    native.emit?.(videoFrame(1));
    await it.next();
    void it.return?.();

    expect(track.getStats().framesDelivered).toBe(1);
  });
});

describe('RemoteVideoTrack frameDropped event', () => {
  it('emits a coalesced count', async () => {
    vi.useFakeTimers();
    try {
      const native = fakeNativeVideo();
      const track = new RemoteVideoTrack(native as never);
      const seen: Array<[number, number]> = [];
      track.on('frameDropped', (c, us) => seen.push([c, us]));

      track.frames({ mode: 'latest', maxQueue: 1 });
      for (let i = 0; i < 4; i++) native.emit?.(videoFrame(i));

      await vi.advanceTimersByTimeAsync(600);
      expect(seen).toHaveLength(1);
      expect(seen[0][0]).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('delivered frame close()', () => {
  it('is idempotent and makes plane reads throw', async () => {
    const native = fakeNativeVideo();
    const track = new RemoteVideoTrack(native as never);
    const it = track.frames({ mode: 'queue', maxQueue: 2 });
    native.emit?.(videoFrame(1));

    const frame = (await it.next()).value as VideoFrame;
    // Readable before close.
    expect(frame.y.data.length).toBe(4);

    frame.close?.();
    frame.close?.(); // double close is a no-op

    expect(() => frame.y).toThrow(/closed/);
    expect(() => frame.u).toThrow(/closed/);
    expect(() => frame.v).toThrow(/closed/);
    // Non-plane metadata stays readable.
    expect(frame.frameId).toBe(1);
  });

  it('leaves an unclosed frame fully readable', async () => {
    const native = fakeNativeVideo();
    const track = new RemoteVideoTrack(native as never);
    const it = track.frames({ mode: 'queue', maxQueue: 2 });
    native.emit?.(videoFrame(2));

    const frame = (await it.next()).value as VideoFrame;
    expect(frame.y.data.length).toBe(4);
    expect(frame.v.stride).toBe(2);
  });
});

describe('RemoteAudioTrack', () => {
  it('defaults to queue mode with a jitter-smoothing buffer', async () => {
    const native = fakeNativeAudio();
    const track = new RemoteAudioTrack(native as never);
    const it = track.frames();

    const frame = { pcm: Buffer.alloc(960), frames: 480, timestamp: 5000, frameId: 1 };
    native.emit?.(frame as AudioFrame);
    const got = (await it.next()).value as AudioFrame;
    expect(got.frameId).toBe(1);
    expect(track.getStats().maxQueue).toBe(10);
  });

  it('exposes close() over the pcm buffer', async () => {
    const native = fakeNativeAudio();
    const track = new RemoteAudioTrack(native as never);
    const it = track.frames();
    native.emit?.({ pcm: Buffer.alloc(4), frames: 2, timestamp: 1, frameId: 1 } as AudioFrame);

    const frame = (await it.next()).value as AudioFrame;
    expect(frame.pcm.length).toBe(4);
    frame.close?.();
    expect(() => frame.pcm).toThrow(/closed/);
  });
});

describe('RemoteDataTrack', () => {
  it('reads through to the native track', () => {
    const track = new RemoteDataTrack(fakeNativeData() as never);
    expect(track.name).toBe('chat');
    expect(track.sid).toBe('MT-data');
    expect(track.kind).toBe('data');
    expect(track.reliable).toBe(true);
    expect(track.ordered).toBe(true);
    expect(track.maxPacketLifeTime).toBeNull();
    expect(track.maxRetransmits).toBeNull();
  });

  it('attaches the native callback lazily, only once', () => {
    const native = fakeNativeData();
    const track = new RemoteDataTrack(native as never);
    expect(native.emit).toBeUndefined();

    const seen: unknown[] = [];
    track.on('message', d => seen.push(d));
    track.on('message', d => seen.push(d));
    expect(native.emit).toBeDefined();

    native.emit?.('hello');
    expect(seen).toEqual(['hello', 'hello']);
  });

  it('_end detaches the native callback exactly once', () => {
    const native = fakeNativeData();
    const track = new RemoteDataTrack(native as never);
    track.on('message', () => {});
    track._end();
    track._end();
    expect(native.removed).toBe(1);
  });

  it('_end is a no-op when nothing was ever attached', () => {
    const native = fakeNativeData();
    const track = new RemoteDataTrack(native as never);
    track._end();
    expect(native.removed).toBe(0);
  });

  it('tolerates a native remove that throws after the Room ended', () => {
    const native = fakeNativeData();
    native.removeMessageCallback = () => {
      throw new Error('gone');
    };
    const track = new RemoteDataTrack(native as never);
    track.on('message', () => {});
    expect(() => track._end()).not.toThrow();
  });
});

describe('track registry', () => {
  it('returns a stable wrapper for the same SID', () => {
    const a = wrapRemoteTrack(fakeNativeVideo('MT-1') as never);
    const b = wrapRemoteTrack(fakeNativeVideo('MT-1') as never);
    // The native layer mints a new object per event; the wrapper must not follow.
    expect(a).toBe(b);
  });

  it('builds the right class per kind', () => {
    expect(wrapRemoteTrack(fakeNativeVideo('MT-v') as never)).toBeInstanceOf(RemoteVideoTrack);
    expect(wrapRemoteTrack(fakeNativeAudio('MT-a') as never)).toBeInstanceOf(RemoteAudioTrack);
    expect(wrapRemoteTrack(fakeNativeData('MT-d') as never)).toBeInstanceOf(RemoteDataTrack);
  });

  it('replaces a cached wrapper whose kind does not match', () => {
    const video = wrapRemoteTrack(fakeNativeVideo('MT-same') as never);
    const audio = wrapRemoteTrack(fakeNativeAudio('MT-same') as never);
    expect(video).not.toBe(audio);
    expect(audio).toBeInstanceOf(RemoteAudioTrack);
  });

  it('does not cache a track with no SID', () => {
    const a = wrapRemoteTrack({ ...fakeNativeVideo(), sid: undefined } as never);
    const b = wrapRemoteTrack({ ...fakeNativeVideo(), sid: undefined } as never);
    expect(a).not.toBe(b);
  });

  it('rejects an unknown track kind', () => {
    expect(() => wrapRemoteTrack({ sid: 'MT-x', kind: 'haptic' } as never)).toThrow(
      /Unexpected remote track kind/,
    );
  });

  it('peek finds a wrapped track without creating one', () => {
    expect(peekRemoteTrack('MT-absent')).toBeUndefined();
    const t = wrapRemoteTrack(fakeNativeVideo('MT-peek') as never);
    expect(peekRemoteTrack('MT-peek')).toBe(t);
  });

  it('release ends the receiver and forgets the track', () => {
    const native = fakeNativeVideo('MT-rel');
    const track = wrapRemoteTrack(native as never) as RemoteVideoTrack;
    track.frames();
    releaseRemoteTrack('MT-rel');

    expect(peekRemoteTrack('MT-rel')).toBeUndefined();
    expect(native.detached).toBe(1);
  });

  it('release is a no-op for an unknown SID', () => {
    expect(() => releaseRemoteTrack('MT-nope')).not.toThrow();
  });

  it('releaseAll ends every wrapper', () => {
    const v = fakeNativeVideo('MT-all-v');
    wrapRemoteTrack(v as never);
    (peekRemoteTrack('MT-all-v') as RemoteVideoTrack).frames();
    wrapRemoteTrack(fakeNativeAudio('MT-all-a') as never);

    releaseAllRemoteTracks();

    expect(peekRemoteTrack('MT-all-v')).toBeUndefined();
    expect(peekRemoteTrack('MT-all-a')).toBeUndefined();
    expect(v.detached).toBe(1);
  });
});
