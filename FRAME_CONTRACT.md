# Frame contract

The precise behavior of the raw-frame API: buffer ownership, backpressure and
drop semantics, and the invariants the publish and receive paths guarantee.
[README.md](README.md) covers usage; this document covers the guarantees.

## Buffer ownership

**Publish.** `write()` copies every buffer synchronously before it returns. The
caller may reuse or free `y.data`, `u.data`, `v.data` and `pcm` immediately.
There is no borrow, and no lifetime obligation.

**Receive.** A delivered frame is an owned copy in JavaScript memory. The SDK
keeps no reference to it after delivery, so a frame may be held across `await`,
transferred to a `worker_thread`, or batched, with no restriction.

`close()` is an optional hint that releases the plane buffers immediately rather
than waiting for garbage collection. It is not required for correctness. It is
idempotent, and reading plane data (`y`/`u`/`v`, or `pcm`) after `close()`
throws. Non-plane metadata stays readable.

## When `write()` returns `false`

`false` always means the frame was not sent. It never means "buffer full, wait
for drain" - that is the Node `Writable` convention, and tracks are deliberately
not presented as Node streams.

| Kind  | `false` means                                                                                                                                                                         |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Video | libwebrtc's adapter rejected the frame: most often the encoder sink has not attached yet (a write before `connect()` resolves), and otherwise rate-limiting or a rejected resolution. |
| Audio | The write did not fit in the bounded publish queue. Nothing was buffered: a rejected write is never partially published.                                                              |

Invalid input does not return `false`; it throws `TypeError` or `RangeError`.
The distinction is deliberate: `false` is a runtime condition to react to, an
exception is a programming error to fix.

## Backpressure and drops

Every frame queue is bounded. Blocking the media engine and buffering without
limit are both rejected: blocking corrupts reconnection and statistics, and at
roughly 41 MB/s per 720p30 video track, unbounded buffering is an eventual
out-of-memory failure. A full receive queue drops; a full audio publish queue
rejects the write, because the publisher is a caller that can be told `false`
while a decoder thread cannot.

### Where frames are dropped

There are two queues in the receive path, and `DeliveryStats.framesDropped` is
the **sum** across both, so it is the total the consumer never saw.

| Queue                 | Location                        | Policy                                                                                                                                                       |
| --------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Native transfer queue | Before the native-to-JS handoff | Bounded to the resolved `maxQueue`, drop-oldest. Bounding it here is what stops a `latest` consumer holding a deep queue of ~1.3 MB frames in native memory. |
| JS policy queue       | After the handoff               | The `mode`/`maxQueue`/`drop` policy given to `frames()`.                                                                                                     |

Publish is different. Video publish is synchronous - `write()` hands the frame
straight to the encoder - so there is no SDK-side send queue at all, and
`sendQueueDepth`/`maxQueue` are always `0`. Audio publish has a real queue,
drained one 10 ms chunk at a time, so its depth and bound are meaningful.

The audio publish queue rejects rather than sheds. A `write()` is accepted only
if it fits whole within `source.maxQueue` (10 ms chunks, default 50, so ~500 ms);
otherwise nothing is buffered and `write()` returns `false`. A single `write()`
larger than the bound can never fit and is always rejected, so size `maxQueue`
to the largest burst the application intends to publish. Rejecting rather than
shedding keeps `false` meaning "not sent" on both paths, and keeps
`WriteStats.framesWritten` an exact count of what the SDK accepted.

### Receive policy

The rest of this section is the **receive** path: the options `frames()` takes.
The publish bound above is separate and is configured through
`source.maxQueue`.

`mode: 'latest'` keeps only the newest frame. `mode: 'queue'` buffers up to
`maxQueue` and then applies `drop`: `'oldest'` sheds from the front, `'newest'`
sheds the arriving frame.

Defaults are media-aware, because the cost of loss differs by kind:

| Kind  | `mode`   | `maxQueue` | Why                                                                 |
| ----- | -------- | ---------- | ------------------------------------------------------------------- |
| Video | `latest` | 1          | A stale frame has no value for live inference.                      |
| Audio | `queue`  | 10         | A small buffer smooths receiver jitter; gaps degrade transcription. |

These are counts of frames, not 10 ms chunks; the publish-side `source.maxQueue`
is the one measured in chunks.

`maxQueue` is capped at 1024 so a misconfiguration cannot exhaust memory.

**Ordering is preserved.** In `queue` mode, frames are delivered in arrival
order. Dropping removes frames from the sequence; it never reorders the ones
that survive.

A frame handed directly to a waiting consumer is never queued, so no policy
applies to it and it cannot be dropped.

## Observability

Every drop is counted. Nothing is discarded silently anywhere in either path.

| Signal                  | Direction | Shape                                                                                                                  |
| ----------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------- |
| `track.getStats()`      | Receive   | `DeliveryStats`: `framesDelivered`, `framesDropped`, `queueDepth`, `maxQueue`, `lastTimestamp?`                        |
| `track.getWriteStats()` | Publish   | `WriteStats`: `framesWritten`, `framesDropped`, `sendQueueDepth`, `maxQueue`, `lastTimestamp?`, `timestampRegressions` |
| `frameDropped` event    | Receive   | `(count, sinceLastUs)`, coalesced over 500 ms                                                                          |

Receive stats remain readable after the receiver ends, reporting the final
numbers, so a summary can be taken during teardown.

There is no separate underrun signal. An idle track is indistinguishable from a
stalled one at this layer; use `framesDelivered` against wall-clock time, or the
WebRTC statistics from `Room.getStats()`, to tell them apart.

Audio publish counters split by scope. `framesWritten`, `framesDropped`,
`lastTimestamp` and `timestampRegressions` count one track's own `write()`
calls. `sendQueueDepth` and `maxQueue` describe the audio device, which is
shared by every local audio track in the process; `source.maxQueue` binds that
same shared device, so the most recent value passed to `createLocalAudioTrack`
applies to all of them. With one local audio track - the normal case - the
distinction does not arise.

## Timestamps

`timestamp` is a plain `number` of **microseconds**, in both directions.
Microsecond resolution stays exact in a JS number for roughly 285 years, and the
engine reports microseconds natively, so no wider integer type is needed.

Omitting `timestamp` on publish stamps the frame "now", which is correct for an
application-paced live source.

The two publish paths use the supplied `timestamp` differently. Video carries it
through to the encoded frame. Audio publish is strictly FIFO - the audio device
emits queued samples on its own 10 ms cadence - so an audio `timestamp` is
observability-only: it feeds `WriteStats.lastTimestamp` and
`WriteStats.timestampRegressions` and does not alter what is sent or when.

**Non-monotonic timestamps are accepted and counted, not rejected.** A timestamp
that does not advance past the previous one increments
`WriteStats.timestampRegressions`. Rejecting would break a legitimate producer
that restarts, such as a looping file source; silently reordering or discarding
would hide a real problem. A rising count on a live source means the supplied
timestamps are wrong, which shows up downstream as jitter.

`frameId` is an SDK-generated monotonic per-track counter on received frames.
Use it for gap and drop detection. There is no `frameId` on input: correlate a
published frame by its `timestamp`.

## Publish invariants

- **Audio format is fixed**: PCM S16LE, 48 kHz, mono. `AudioFrameInput` exposes
  no sample-rate or channel fields, because the engine's encoder path is wired
  for exactly this and anything else would be silently wrong rather than
  resampled. Resampling is the application's responsibility.
- **Video format is fixed**: I420. `format` is optional on input but rejected if
  present and not `'I420'`.
- **No dynamic resize.** Where a track was created with a `source`, a frame whose
  dimensions disagree is rejected rather than rescaled. Without a `source`, the
  encoder follows what is written.
- **Dimensions must be positive and even.** I420 chroma is subsampled by two in
  each dimension, so an odd dimension has no well-defined chroma plane size.
- **Strides must be at least the plane width.** Padding beyond that is fine and
  is preserved through the copy.

## Execution model and threading

Frames are delivered to the event loop as ready, application-owned objects.
Delivery is serial and in order per track.

Decoded frames arrive on native decoder threads. The bulk plane copy out of
libwebrtc happens there, off the event loop; the copy into JS buffers currently
happens on the loop. Whether that second copy moves off-loop is an internal
optimization that can land without an API change.

The SDK cannot stop an application blocking the loop with synchronous per-frame
work. Heavy per-frame CPU work belongs in `worker_threads` or in an asynchronous
service call; frames are structured to transfer to a worker without copying.

A track supports a **single receiver**. Calling `frames()` while a receiver is
active throws. An application that needs several consumers fans out inside its
own loop. The iterator ends on unsubscribe and on Room disconnect or dispose, so
a `for await` loop exits on its own rather than hanging.

## Data track

`send()` accepts a string or a `Buffer`. Messages larger than **64 KB**
(`kMaxMessageSize`) are rejected synchronously with a `RangeError` and never
transmitted; the limit is counted in UTF-8 bytes, not characters.

`send()` returns a promise that **always resolves**, never rejects, so a
fire-and-forget send cannot produce an unhandled rejection. It resolves to
`{ ok, messageId, error? }` once the engine has processed the send.

If the track is destroyed while a send is still in flight, the outstanding
promise resolves with `ok: false` and an `error` naming the teardown, rather
than being left pending.

## ABI and compatibility

The addon is built with `node-addon-api` (N-API), so it is ABI-stable across
Node versions within the N-API version it targets, and does not need rebuilding
for each Node release. `engines.node` records the supported range. The supported
platform for the beta is Linux x86-64; the binary is x86-64 only, with no arm64
build. See [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md) for building from source.
