import { describe, it, expect, vi } from 'vitest';
import { FrameStream, resolveOptions, MAX_QUEUE_CEILING } from '../lib/frame_stream.js';

type TestFrame = { timestamp: number; id: number };

function frame(id: number): TestFrame {
  return { timestamp: id * 1000, id };
}

function makeStream(
  opts: Partial<{ mode: 'latest' | 'queue'; maxQueue: number; drop: 'oldest' | 'newest' }> = {},
  onDropped?: (count: number, sinceLastUs: number) => void,
  nativeStats?: () => { nativeDropped: number; nativeQueueDepth: number },
) {
  return new FrameStream<TestFrame>(
    { mode: 'queue', maxQueue: 3, drop: 'oldest', ...opts },
    onDropped,
    nativeStats,
  );
}

describe('resolveOptions', () => {
  it('applies the media-aware defaults', () => {
    expect(resolveOptions('video')).toEqual({ mode: 'latest', maxQueue: 1, drop: 'oldest' });
    expect(resolveOptions('audio')).toEqual({ mode: 'queue', maxQueue: 10, drop: 'oldest' });
  });

  it("pins maxQueue to 1 for mode 'latest' unless asked for more", () => {
    expect(resolveOptions('audio', { mode: 'latest' }).maxQueue).toBe(1);
    expect(resolveOptions('audio', { mode: 'latest', maxQueue: 5 }).maxQueue).toBe(5);
  });

  it('keeps an explicit maxQueue for queue mode', () => {
    expect(resolveOptions('video', { mode: 'queue', maxQueue: 7 })).toEqual({
      mode: 'queue',
      maxQueue: 7,
      drop: 'oldest',
    });
  });

  it('accepts an explicit drop policy', () => {
    expect(resolveOptions('audio', { drop: 'newest' }).drop).toBe('newest');
  });

  it('rejects an invalid mode or drop', () => {
    expect(() => resolveOptions('video', { mode: 'fastest' as never })).toThrow(TypeError);
    expect(() => resolveOptions('video', { drop: 'middle' as never })).toThrow(TypeError);
  });

  it('rejects a non-object options argument', () => {
    expect(() => resolveOptions('video', 5 as never)).toThrow(TypeError);
    expect(() => resolveOptions('video', null as never)).toThrow(TypeError);
  });

  it('rejects a maxQueue that is not a positive integer', () => {
    for (const bad of [0, -1, 1.5, NaN, '3']) {
      expect(() => resolveOptions('video', { maxQueue: bad as never })).toThrow(RangeError);
    }
  });

  it('enforces the ceiling so a misconfiguration cannot exhaust memory', () => {
    expect(() => resolveOptions('video', { maxQueue: MAX_QUEUE_CEILING + 1 })).toThrow(RangeError);
    expect(resolveOptions('video', { maxQueue: MAX_QUEUE_CEILING }).maxQueue).toBe(
      MAX_QUEUE_CEILING,
    );
  });
});

describe('FrameStream delivery', () => {
  it('delivers a queued frame to a later consumer', async () => {
    const s = makeStream();
    s.push(frame(1));
    await expect(s.next()).resolves.toEqual({ value: frame(1), done: false });
  });

  it('hands a frame straight to a waiting consumer without queueing', async () => {
    const s = makeStream();
    const pending = s.next();
    s.push(frame(1));
    await expect(pending).resolves.toEqual({ value: frame(1), done: false });
    expect(s.getStats().queueDepth).toBe(0);
  });

  it('preserves order in queue mode', async () => {
    const s = makeStream({ maxQueue: 5 });
    s.push(frame(1));
    s.push(frame(2));
    s.push(frame(3));
    const got = [(await s.next()).value, (await s.next()).value, (await s.next()).value];
    expect(got.map(f => (f as TestFrame).id)).toEqual([1, 2, 3]);
  });

  it('is async-iterable and exits when the stream ends', async () => {
    const s = makeStream({ maxQueue: 5 });
    s.push(frame(1));
    s.push(frame(2));
    s.end();

    const seen: number[] = [];
    for await (const f of s) seen.push(f.id);
    // end() releases queued frames, so the loop completes immediately.
    expect(seen).toEqual([]);
  });

  it('drains queued frames then blocks until ended', async () => {
    const s = makeStream({ maxQueue: 5 });
    s.push(frame(1));

    const seen: number[] = [];
    const loop = (async () => {
      for await (const f of s) seen.push(f.id);
    })();

    await new Promise(r => setTimeout(r, 10));
    expect(seen).toEqual([1]);

    s.push(frame(2));
    await new Promise(r => setTimeout(r, 10));
    expect(seen).toEqual([1, 2]);

    s.end();
    await loop;
    expect(seen).toEqual([1, 2]);
  });

  it('ends an iterator that is parked waiting for a frame', async () => {
    const s = makeStream();
    const pending = s.next();
    s.end();
    await expect(pending).resolves.toEqual({ value: undefined, done: true });
  });

  it('reports done for next() after end', async () => {
    const s = makeStream();
    s.end();
    await expect(s.next()).resolves.toEqual({ value: undefined, done: true });
  });

  it('ignores pushes after end', async () => {
    const s = makeStream();
    s.end();
    s.push(frame(1));
    expect(s.getStats().queueDepth).toBe(0);
    await expect(s.next()).resolves.toEqual({ value: undefined, done: true });
  });

  it('end() is idempotent', () => {
    const s = makeStream();
    s.end();
    expect(() => s.end()).not.toThrow();
  });

  it('return() ends the stream so `break` releases the track', async () => {
    const s = makeStream({ maxQueue: 5 });
    s.push(frame(1));
    s.push(frame(2));

    const seen: number[] = [];
    for await (const f of s) {
      seen.push(f.id);
      break;
    }
    expect(seen).toEqual([1]);
    await expect(s.next()).resolves.toEqual({ value: undefined, done: true });
  });
});

describe('FrameStream backpressure policy', () => {
  it("mode 'latest' keeps only the newest frame", async () => {
    const s = makeStream({ mode: 'latest', maxQueue: 1 });
    s.push(frame(1));
    s.push(frame(2));
    s.push(frame(3));

    const first = (await s.next()).value as TestFrame;
    expect(first.id).toBe(3);
    expect(s.getStats().framesDropped).toBe(2);
  });

  it("drop 'oldest' sheds from the front and keeps the newest", async () => {
    const s = makeStream({ maxQueue: 2, drop: 'oldest' });
    s.push(frame(1));
    s.push(frame(2));
    s.push(frame(3));

    const ids = [(await s.next()).value, (await s.next()).value].map(f => (f as TestFrame).id);
    expect(ids).toEqual([2, 3]);
    expect(s.getStats().framesDropped).toBe(1);
  });

  it("drop 'newest' sheds the arriving frame and keeps the queue", async () => {
    const s = makeStream({ maxQueue: 2, drop: 'newest' });
    s.push(frame(1));
    s.push(frame(2));
    s.push(frame(3));

    const ids = [(await s.next()).value, (await s.next()).value].map(f => (f as TestFrame).id);
    expect(ids).toEqual([1, 2]);
    expect(s.getStats().framesDropped).toBe(1);
  });

  it('never grows past maxQueue no matter how many frames arrive', () => {
    const s = makeStream({ maxQueue: 4 });
    for (let i = 0; i < 1000; i++) s.push(frame(i));
    expect(s.getStats().queueDepth).toBe(4);
    expect(s.getStats().framesDropped).toBe(996);
  });
});

describe('FrameStream statistics', () => {
  it('starts at zero', () => {
    expect(makeStream().getStats()).toEqual({
      framesDelivered: 0,
      framesDropped: 0,
      queueDepth: 0,
      maxQueue: 3,
    });
  });

  it('counts delivered frames and tracks the last timestamp', async () => {
    const s = makeStream({ maxQueue: 5 });
    s.push(frame(1));
    s.push(frame(2));
    await s.next();
    await s.next();

    const stats = s.getStats();
    expect(stats.framesDelivered).toBe(2);
    expect(stats.lastTimestamp).toBe(2000);
  });

  it('records the timestamp of a frame handed directly to a waiter', async () => {
    const s = makeStream();
    const pending = s.next();
    s.push(frame(7));
    await pending;
    expect(s.getStats()).toMatchObject({ framesDelivered: 1, lastTimestamp: 7000 });
  });

  it('sums native transfer-queue drops and depth into the totals', () => {
    const s = makeStream({ maxQueue: 1 }, undefined, () => ({
      nativeDropped: 10,
      nativeQueueDepth: 2,
    }));
    s.push(frame(1));
    s.push(frame(2)); // one JS-side drop

    const stats = s.getStats();
    // Loss the consumer never saw is the sum across both queues.
    expect(stats.framesDropped).toBe(11);
    expect(stats.queueDepth).toBe(1 + 2);
  });

  it('keeps reporting after end', () => {
    const s = makeStream({ maxQueue: 1 });
    s.push(frame(1));
    s.push(frame(2));
    s.end();
    expect(s.getStats().framesDropped).toBe(1);
  });
});

describe('FrameStream drop reporting', () => {
  it('coalesces drops into a single callback', async () => {
    vi.useFakeTimers();
    try {
      const onDropped = vi.fn();
      const s = makeStream({ maxQueue: 1 }, onDropped);

      s.push(frame(1));
      for (let i = 2; i <= 6; i++) s.push(frame(i));
      // Nothing reported yet: the report is batched.
      expect(onDropped).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(600);
      expect(onDropped).toHaveBeenCalledTimes(1);
      expect(onDropped.mock.calls[0][0]).toBe(5);
      // First report has no previous report to measure from.
      expect(onDropped.mock.calls[0][1]).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports elapsed microseconds on subsequent batches', async () => {
    vi.useFakeTimers();
    try {
      const onDropped = vi.fn();
      const s = makeStream({ maxQueue: 1 }, onDropped);

      s.push(frame(1));
      s.push(frame(2));
      await vi.advanceTimersByTimeAsync(600);

      s.push(frame(3));
      await vi.advanceTimersByTimeAsync(600);

      expect(onDropped).toHaveBeenCalledTimes(2);
      expect(onDropped.mock.calls[1][1]).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not fire a callback when nothing was dropped', async () => {
    vi.useFakeTimers();
    try {
      const onDropped = vi.fn();
      const s = makeStream({ maxQueue: 5 }, onDropped);
      s.push(frame(1));
      await vi.advanceTimersByTimeAsync(1000);
      expect(onDropped).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels a pending report when the stream ends', async () => {
    vi.useFakeTimers();
    try {
      const onDropped = vi.fn();
      const s = makeStream({ maxQueue: 1 }, onDropped);
      s.push(frame(1));
      s.push(frame(2));
      s.end();
      await vi.advanceTimersByTimeAsync(1000);
      expect(onDropped).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('counts drops even with no reporting callback attached', () => {
    const s = makeStream({ maxQueue: 1 });
    s.push(frame(1));
    s.push(frame(2));
    expect(s.getStats().framesDropped).toBe(1);
  });
});
