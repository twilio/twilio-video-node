import { TypedEventEmitter } from './typed_emitter.js';
import { FrameStream, resolveOptions } from './frame_stream.js';
import type {
  AudioFrame,
  DeliveryStats,
  FrameDeliveryOptions,
  NativeRemoteAudioTrack,
  NativeRemoteDataTrack,
  NativeRemoteVideoTrack,
  Track,
  VideoContentPreferences,
  VideoFrame,
} from './types.js';

/** Events emitted by {@link RemoteVideoTrack} and {@link RemoteAudioTrack}. */
export type RemoteMediaTrackEvents = {
  /**
   * Frames were dropped by the backpressure policy. Coalesced: `count` is the
   * number dropped since the last event, `sinceLastUs` the microseconds elapsed
   * since it (`0` for the first event).
   */
  frameDropped: (count: number, sinceLastUs: number) => void;
};

const CLOSED = Symbol('closed');

/**
 * Add the optional deterministic-release hint to a delivered frame.
 *
 * `close()` is not required for correctness - the frame is an owned copy and
 * GC reclaims it - but calling it releases the plane buffers promptly, which
 * matters when frames are held across `await`. Double-close is a no-op;
 * reading plane data after close throws.
 */
function attachClose<T extends object>(frame: T, planeKeys: readonly string[]): T {
  const target = frame as T & { [CLOSED]?: boolean };
  const stash = new Map<string, unknown>();
  for (const key of planeKeys) {
    stash.set(key, (target as Record<string, unknown>)[key]);
    Object.defineProperty(target, key, {
      configurable: true,
      enumerable: true,
      get() {
        if (target[CLOSED]) {
          throw new Error(`Frame is closed; '${key}' is no longer readable`);
        }
        return stash.get(key);
      },
    });
  }
  Object.defineProperty(target, 'close', {
    configurable: true,
    enumerable: false,
    value: () => {
      if (target[CLOSED]) return;
      target[CLOSED] = true;
      stash.clear();
    },
  });
  return target;
}

/** Shared frames()/getStats() plumbing for the two media track kinds. */
abstract class RemoteMediaTrack<
  N extends NativeRemoteVideoTrack | NativeRemoteAudioTrack,
  F extends { timestamp: number },
> extends TypedEventEmitter<RemoteMediaTrackEvents> {
  /** @internal */
  readonly _native: N;
  private stream: FrameStream<F> | null = null;
  private lastStats: DeliveryStats | null = null;

  protected abstract readonly frameKind: 'video' | 'audio';
  protected abstract readonly planeKeys: readonly string[];

  constructor(native: N) {
    super();
    this._native = native;
  }

  /** Track name, as set by the publisher. */
  get name(): string {
    return this._native.name;
  }

  /** This track's SID (`MT...`). */
  get sid(): Track.SID {
    return this._native.sid;
  }

  /** Whether the publisher currently has the track enabled. */
  get enabled(): boolean {
    return this._native.enabled;
  }

  /**
   * Receive decoded frames by async iteration. Awaiting each frame applies
   * backpressure: while the consumer is busy, frames arriving behind it are
   * subject to the drop policy in `options`.
   *
   * A track supports a single receiver. An application that needs to do several
   * things with one stream fans out inside its own loop.
   *
   * The iterator completes when the track is unsubscribed or the Room
   * disconnects, so a `for await` loop exits on its own.
   *
   * @throws {Error} If a receiver is already active on this track.
   * @throws {TypeError} If `mode` or `drop` is invalid.
   * @throws {RangeError} If `maxQueue` is out of range.
   */
  frames(options?: FrameDeliveryOptions): AsyncIterableIterator<F> {
    if (this.stream) {
      throw new Error(
        `A receiver is already active on track ${this.sid}. Each track supports a single receiver; ` +
          'fan out within your own loop if you need several consumers.',
      );
    }
    const resolved = resolveOptions(this.frameKind, options);

    const stream: FrameStream<F> = new FrameStream<F>(
      resolved,
      (count, sinceLastUs) => this.emit('frameDropped', count, sinceLastUs),
      () => this._native._sinkStats(),
      () => {
        // Always the live receiver: end() is idempotent, so this fires once per
        // stream, and frames() throws while one is active - so a stream can
        // only end while it is still the current one.
        // Keep the final numbers readable after teardown.
        this.lastStats = stream.getStats();
        this.stream = null;
        try {
          this._native._detachFrameSink();
        } catch {
          // The native track may already be gone if the Room ended remotely.
        }
      },
    );
    this.stream = stream;

    // The native signature is per-kind (VideoFrame | AudioFrame); this base
    // class is generic over F, so the callback is bridged through one cast
    // rather than duplicating frames() in both subclasses.
    const attach = this._native._attachFrameSink as unknown as (
      cb: (frame: F) => void,
      maxQueueDepth?: number,
    ) => void;
    attach.call(
      this._native,
      (frame: F) => {
        stream.push(attachClose(frame as unknown as object, this.planeKeys) as F);
      },
      resolved.maxQueue,
    );

    return stream;
  }

  /**
   * Per-track receive statistics. Counts both frames shed by the JS policy
   * queue and frames shed at the native transfer boundary.
   */
  getStats(): DeliveryStats {
    if (this.stream) return this.stream.getStats();
    if (this.lastStats) return this.lastStats;
    return { framesDelivered: 0, framesDropped: 0, queueDepth: 0, maxQueue: 0 };
  }

  /**
   * @internal Ends any active receiver. Called on unsubscribe and on Room
   * teardown so a `for await` loop exits rather than hanging.
   */
  _end(): void {
    this.stream?.end();
  }
}

/** A remote participant's video track. Read frames with {@link RemoteVideoTrack.frames}. */
export class RemoteVideoTrack extends RemoteMediaTrack<NativeRemoteVideoTrack, VideoFrame> {
  readonly kind = 'video' as const;
  protected readonly frameKind = 'video' as const;
  protected readonly planeKeys = ['y', 'u', 'v'] as const;

  /**
   * Whether the SDK has switched this track off under bandwidth pressure. While
   * switched off, no frames are delivered.
   */
  get isSwitchedOff(): boolean {
    return this._native.isSwitchedOff;
  }

  /** Tell the publisher what resolution this subscriber actually needs. */
  setContentPreferences(preferences: VideoContentPreferences): void {
    this._native.setContentPreferences(preferences);
  }
}

/** A remote participant's audio track. Read frames with {@link RemoteAudioTrack.frames}. */
export class RemoteAudioTrack extends RemoteMediaTrack<NativeRemoteAudioTrack, AudioFrame> {
  readonly kind = 'audio' as const;
  protected readonly frameKind = 'audio' as const;
  protected readonly planeKeys = ['pcm'] as const;
}

/** Events emitted by {@link RemoteDataTrack}. */
export type RemoteDataTrackEvents = {
  message: (data: string | Buffer) => void;
};

/**
 * A remote participant's data track. Messages arrive as `message` events.
 */
export class RemoteDataTrack extends TypedEventEmitter<RemoteDataTrackEvents> {
  /** @internal */
  readonly _native: NativeRemoteDataTrack;
  readonly kind = 'data' as const;
  private attached = false;

  constructor(native: NativeRemoteDataTrack) {
    super();
    this._native = native;
  }

  get name(): string {
    return this._native.name;
  }

  get sid(): Track.SID {
    return this._native.sid;
  }

  get maxPacketLifeTime(): number | null {
    return this._native.maxPacketLifeTime;
  }

  get maxRetransmits(): number | null {
    return this._native.maxRetransmits;
  }

  get reliable(): boolean {
    return this._native.reliable;
  }

  get ordered(): boolean {
    return this._native.ordered;
  }

  /**
   * @internal Wires the native message callback the first time someone listens,
   * so an unobserved track does not pay for message delivery.
   */
  override on<K extends keyof RemoteDataTrackEvents & string>(
    event: K,
    listener: RemoteDataTrackEvents[K],
  ): this {
    if (event === 'message' && !this.attached) {
      this.attached = true;
      this._native.onMessage((data: string | Buffer) => this.emit('message', data));
    }
    return super.on(event, listener);
  }

  /** @internal Detaches the native callback on unsubscribe or Room teardown. */
  _end(): void {
    if (!this.attached) return;
    this.attached = false;
    try {
      this._native.removeMessageCallback();
    } catch {
      // Native track may already be gone if the Room ended remotely.
    }
  }
}

/** Any remote track kind. */
export type RemoteTrack = RemoteVideoTrack | RemoteAudioTrack | RemoteDataTrack;
