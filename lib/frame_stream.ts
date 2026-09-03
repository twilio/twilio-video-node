import type { BackpressureMode, DeliveryStats, FrameDeliveryOptions } from './types.js';

/**
 * Upper bound on any configured queue depth. A misconfigured `maxQueue` must
 * not be able to exhaust memory: at 720p an I420 frame is ~1.3 MB, so 1024
 * frames is already well past any useful buffering.
 */
export const MAX_QUEUE_CEILING = 1024;

/** Blueprint defaults: video keeps only the newest frame, audio smooths a little jitter. */
export const DEFAULTS: Record<
  'video' | 'audio',
  Required<Omit<FrameDeliveryOptions, 'drop'>> & { drop: 'oldest' | 'newest' }
> = {
  video: { mode: 'latest', maxQueue: 1, drop: 'oldest' },
  audio: { mode: 'queue', maxQueue: 10, drop: 'oldest' },
};

/** How long drops are batched before a `frameDropped` event is emitted. */
export const DROP_COALESCE_MS = 500;

function isPositiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0;
}

/**
 * Normalize and validate {@link FrameDeliveryOptions} against the per-kind
 * defaults. `mode: 'latest'` pins `maxQueue` to 1 unless the caller asked for
 * more, since "keep only the most recent frame" is what 'latest' means.
 *
 * @throws {TypeError} If `mode` or `drop` is not one of the allowed values.
 * @throws {RangeError} If `maxQueue` is not a positive integer within {@link MAX_QUEUE_CEILING}.
 */
export function resolveOptions(
  kind: 'video' | 'audio',
  options: FrameDeliveryOptions = {},
): { mode: BackpressureMode; maxQueue: number; drop: 'oldest' | 'newest' } {
  if (options === null || typeof options !== 'object') {
    throw new TypeError('frames() options must be an object');
  }
  const d = DEFAULTS[kind];

  const mode = options.mode ?? d.mode;
  if (mode !== 'latest' && mode !== 'queue') {
    throw new TypeError(`mode must be 'latest' or 'queue'; got ${String(mode)}`);
  }

  const drop = options.drop ?? d.drop;
  if (drop !== 'oldest' && drop !== 'newest') {
    throw new TypeError(`drop must be 'oldest' or 'newest'; got ${String(drop)}`);
  }

  let maxQueue: number;
  if (options.maxQueue === undefined) {
    maxQueue = mode === 'latest' ? 1 : d.maxQueue;
  } else {
    if (!isPositiveInt(options.maxQueue)) {
      throw new RangeError(`maxQueue must be a positive integer; got ${String(options.maxQueue)}`);
    }
    if (options.maxQueue > MAX_QUEUE_CEILING) {
      throw new RangeError(
        `maxQueue must be at most ${MAX_QUEUE_CEILING}; got ${options.maxQueue}`,
      );
    }
    maxQueue = options.maxQueue;
  }

  return { mode, maxQueue, drop };
}

/**
 * The bounded, drop-by-default, observable queue behind
 * `RemoteVideoTrack.frames()` / `RemoteAudioTrack.frames()`.
 *
 * Awaiting a frame is the backpressure: while the consumer is busy, frames
 * arriving behind it are subject to the drop policy rather than buffered
 * without limit. Every drop is counted, and drops are reported through a
 * coalesced callback so loss is never silent.
 *
 * Frames shed here are shed *after* the native-to-JS handoff. Frames can also
 * be shed *before* it, in the native transfer queue; `DeliveryStats` sums both,
 * so `framesDropped` is the total the consumer never saw.
 */
export class FrameStream<T extends { timestamp: number }> implements AsyncIterableIterator<T> {
  private readonly queue: T[] = [];
  private readonly waiters: Array<(r: IteratorResult<T>) => void> = [];
  private ended = false;

  private delivered = 0;
  private dropped = 0;
  private lastTimestamp: number | undefined;

  private pendingDrops = 0;
  private lastDropReportUs = 0;
  private dropTimer: ReturnType<typeof setTimeout> | null = null;

  readonly mode: BackpressureMode;
  readonly maxQueue: number;
  readonly drop: 'oldest' | 'newest';

  /**
   * @param onDropped - Invoked with the number of frames dropped since the last
   *   report and the microseconds elapsed since it. Coalesced over
   *   {@link DROP_COALESCE_MS}.
   * @param nativeStats - Reads drop/depth counters from the native transfer
   *   queue so {@link getStats} can report the total across both queues.
   * @param onEnd - Invoked once when the stream ends, however it ends: the
   *   consumer breaking out, an unsubscribe, or Room teardown. The owning track
   *   uses it to release the native sink.
   */
  constructor(
    opts: { mode: BackpressureMode; maxQueue: number; drop: 'oldest' | 'newest' },
    private readonly onDropped?: (count: number, sinceLastUs: number) => void,
    private readonly nativeStats?: () => { nativeDropped: number; nativeQueueDepth: number },
    private readonly onEnd?: () => void,
  ) {
    this.mode = opts.mode;
    this.maxQueue = opts.maxQueue;
    this.drop = opts.drop;
  }

  /** Feed a frame in from the native sink. Applies the drop policy. */
  push(frame: T): void {
    if (this.ended) return;

    // A waiting consumer takes the frame directly; nothing is queued, so no
    // policy applies.
    const waiter = this.waiters.shift();
    if (waiter) {
      this.delivered++;
      this.lastTimestamp = frame.timestamp;
      waiter({ value: frame, done: false });
      return;
    }

    if (this.queue.length >= this.maxQueue) {
      if (this.drop === 'newest') {
        // Shed the arriving frame; the queue keeps what it already has.
        this.countDrop();
        return;
      }
      // 'oldest': make room by shedding from the front.
      while (this.queue.length >= this.maxQueue) {
        this.queue.shift();
        this.countDrop();
      }
    }
    this.queue.push(frame);
  }

  private countDrop(): void {
    this.dropped++;
    this.pendingDrops++;
    if (!this.onDropped || this.dropTimer) return;
    this.dropTimer = setTimeout(() => {
      this.dropTimer = null;
      // countDrop() increments pendingDrops before arming this timer and is
      // the only writer, so count is always >= 1 here.
      const count = this.pendingDrops;
      this.pendingDrops = 0;
      const nowUs = Number(process.hrtime.bigint() / 1000n);
      const sinceUs = this.lastDropReportUs === 0 ? 0 : nowUs - this.lastDropReportUs;
      this.lastDropReportUs = nowUs;
      this.onDropped?.(count, sinceUs);
    }, DROP_COALESCE_MS);
    // Never hold the event loop open just to report a drop.
    this.dropTimer.unref?.();
  }

  /**
   * End the stream. In-flight consumers see the iterator complete, queued
   * frames are released, and later pushes are ignored. Idempotent.
   */
  end(): void {
    if (this.ended) return;
    this.ended = true;
    this.queue.length = 0;
    if (this.dropTimer) {
      clearTimeout(this.dropTimer);
      this.dropTimer = null;
    }
    let waiter = this.waiters.shift();
    while (waiter) {
      waiter({ value: undefined, done: true });
      waiter = this.waiters.shift();
    }
    // After the queue is cleared and consumers released, so a handler that
    // reads getStats() sees the final numbers.
    this.onEnd?.();
  }

  /** Per-track receive stats, summing the JS policy queue and the native transfer queue. */
  getStats(): DeliveryStats {
    const native = this.nativeStats?.() ?? { nativeDropped: 0, nativeQueueDepth: 0 };
    const stats: DeliveryStats = {
      framesDelivered: this.delivered,
      framesDropped: this.dropped + native.nativeDropped,
      queueDepth: this.queue.length + native.nativeQueueDepth,
      maxQueue: this.maxQueue,
    };
    if (this.lastTimestamp !== undefined) stats.lastTimestamp = this.lastTimestamp;
    return stats;
  }

  next(): Promise<IteratorResult<T>> {
    const frame = this.queue.shift();
    if (frame !== undefined) {
      this.delivered++;
      this.lastTimestamp = frame.timestamp;
      return Promise.resolve({ value: frame, done: false });
    }
    if (this.ended) {
      return Promise.resolve({ value: undefined, done: true } as IteratorResult<T>);
    }
    return new Promise<IteratorResult<T>>(resolve => this.waiters.push(resolve));
  }

  /** Ends the stream, so `break` or `return` inside a `for await` releases the track. */
  return(): Promise<IteratorResult<T>> {
    this.end();
    return Promise.resolve({ value: undefined, done: true } as IteratorResult<T>);
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<T> {
    return this;
  }
}
