This SDK is currently in beta. See the [README](README.md) for details.

# Unreleased (breaking)

Aligns the frame contract with the Video Node RTC SDK blueprint. The receive API,
the frame shapes and the timestamp type all change, so this warrants a new
preview version rather than folding into `1.0.0-preview.3` below - the exact
number is a release-planning call. Every change is mechanical, and the migration
for each is given here.

## Breaking Changes

### `frames()` replaces `onFrame()`

`RemoteVideoTrack.onFrame()` and `removeFrameCallback()` are removed. Receive
frames by async iteration instead. Awaiting each frame is what applies
backpressure; a callback could not.

```js
// Before
track.onFrame(frame => process(frame));
track.removeFrameCallback();

// After
for await (const frame of track.frames()) {
  await process(frame);
  frame.close?.();
}
// The loop ends on unsubscribe or Room disconnect. `break` releases the track.
```

Each track supports a single receiver. Fan out inside your own loop if several
consumers need the same stream.

### `RemoteDataTrack` messages are an event

```js
// Before
track.onMessage(data => handle(data));
track.removeMessageCallback();

// After
track.on('message', data => handle(data));
```

### Timestamps are microseconds as `number`, not nanoseconds as `bigint`

`timestampNs` and `captureTimestampNs` become `timestamp` and
`captureTimestamp`, in microseconds. Microsecond resolution stays exact in a JS
number for roughly 285 years, and the engine reports microseconds natively, so
this removes a conversion in both directions and lets frame timing be done with
ordinary arithmetic.

```js
// Before
const ms = Number(frame.timestampNs / 1_000_000n);
track.write({ ..., timestampNs: process.hrtime.bigint() });

// After
const ms = frame.timestamp / 1000;
track.write({ ... }); // omit `timestamp` and the SDK stamps "now"
```

### `VideoFrameInput` is planar

Input now uses the same shape as the delivered `VideoFrame`, so a received frame
can be republished without reshaping.

```js
// Before
track.write({
  y,
  u,
  v, // Buffers
  yStride,
  uStride,
  vStride,
  width,
  height,
});

// After
track.write({
  format: 'I420', // optional
  width,
  height,
  y: { data: y, stride: yStride, width, height },
  u: { data: u, stride: uStride, width: width / 2, height: height / 2 },
  v: { data: v, stride: vStride, width: width / 2, height: height / 2 },
});
```

### `LocalDataTrack.send()` returns a promise, and enforces the 64 KB limit

`send()` previously returned `void` and silently discarded a message larger than
`kMaxMessageSize`. It now throws a `RangeError` for an oversize message, and
returns a promise describing the outcome. The promise **always resolves**, so a
fire-and-forget `send()` cannot produce an unhandled rejection.

```js
const result = await track.send('hello');
if (!result.ok) console.warn('send failed:', result.error);
```

### Audio publish is bounded

`LocalAudioTrack.write()` previously buffered up to **45 seconds** of audio and
always returned `true`. The queue is now bounded (~100 ms by default,
configurable through `source.maxQueue` in 10 ms chunks) and `write()` returns
`false` when it had to shed. A producer running at real-time cadence is
unaffected; one running faster now learns it is outrunning the wire instead of
silently accumulating latency.

## Features

- `RemoteVideoTrack.getStats()` / `RemoteAudioTrack.getStats()` return
  `DeliveryStats`: frames delivered, frames dropped, queue depth and the
  configured bound. Drops are counted in both the JS policy queue and the native
  transfer queue, so the number is the total the consumer never saw.
- `LocalVideoTrack.getWriteStats()` / `LocalAudioTrack.getWriteStats()` return
  `WriteStats` for the publish direction.
- A coalesced `frameDropped(count, sinceLastUs)` event on remote media tracks.
- `frames(options)` takes `mode` (`'latest'` | `'queue'`), `maxQueue` and `drop`
  (`'oldest'` | `'newest'`). Defaults are media-aware: video keeps only the
  newest frame, audio buffers a little to smooth jitter. `maxQueue` is capped so
  a misconfiguration cannot exhaust memory.
- `VideoFrame.close()` / `AudioFrame.close()` release the buffers promptly.
  Optional - the frame is an owned copy and GC reclaims it. Idempotent; reading
  plane data after `close()` throws.
- `CreateLocalVideoTrackOptions.source` pins the frame size, so a mismatched
  frame is rejected rather than silently rescaled.
  `CreateLocalAudioTrackOptions.source` bounds the publish queue.
- `ConnectOptions.connectionTimeout` (default 30s) rejects with
  `RoomConnectTimeoutError`. There was previously no timeout at any layer, so a
  wedged connect hung the caller indefinitely.
- One error subclass per known Twilio code, 25 in all, plus typed SDK-local
  errors (`NativeBindingLoadError`, `UnsupportedPlatformError`,
  `RoomConnectTimeoutError`, `DataTrackSendError`). Previously only 5 of the 26
  codes had a class.

## Bug Fixes

- `VideoFrame.frameId` now advances. It was taken from libwebrtc's
  `VideoFrame::id()`, which is not populated on the receive path and read `0`
  for every frame, so gap and drop detection was impossible despite being the
  documented purpose of the field. It is now an SDK-generated monotonic
  per-track counter, matching what the audio path already did.
- Frames dropped at the native-to-JS boundary are counted instead of discarded
  silently. The transfer queue always had a fixed depth of 5 with a drop-oldest
  policy; nothing reported it.

# 1.0.0-preview.3 (September 2, 2026)

## Documentation

- Added an API reference generated with TypeDoc, covering every exported symbol. Build it
  locally with `npm run docs`.

## Breaking Changes

- `VideoCodec` only accepts `'VP8'`, the only video codec this SDK supports in Group Rooms.
  `'H264'` and `'VP9'` are removed from the type and now throw
  `TypeError: Unknown video codec: <name>` from `connect()` instead of being silently accepted.

- `AudioCodec` only accepts `'opus'` and `'PCMU'`, the only audio codecs this SDK supports in
  Group Rooms. `'PCMA'` and `'G722'` are removed from the type and now throw
  `TypeError: Unknown audio codec: <name>` from `connect()`.

- `LocalDataTrack.maxPacketLifeTime` and `maxRetransmits` are now `number | null`, reporting
  `null` when unset instead of `65535`. Check for `null`, or use `reliable`. Both now report the
  value passed to `createLocalDataTrack()`, so a limit of `65535` reads back as `65535`.

- `ErrorCode.TRACK_NAME_TOO_LONG` is renamed to `ErrorCode.TRACK_NAME_INVALID`. The code it maps
  to, `53301`, is Twilio's `TrackNameInvalid`. `ErrorCode.TRACK_NAME_TOO_LONG` now maps to
  `53302`, the code that condition actually reports.

- `createLocalDataTrack()` validates delivery options. `maxPacketLifeTime` and `maxRetransmits`
  must be integers in `[0, 65535]` (`RangeError`, replacing the plain `Error` for negatives);
  `ordered` must be a boolean (`TypeError`). Invalid values were previously coerced.

## Features

- `RemoteDataTrack` exposes `maxPacketLifeTime` and `maxRetransmits`, so a subscriber can tell
  how the publisher configured delivery. A publisher's limit of `65535` reads back as `null`,
  since a subscribed track reports it the same way it reports an unset limit.

- `LocalDataTrackOptions.maxPacketLifeTime` and `maxRetransmits` accept `null`, so a value read
  off a track can be passed back into `createLocalDataTrack()`.

- `trackSubscriptionFailed` passes a `RemoteTrackSubscriptionFailedEvent` (`trackSid`,
  `trackName`, `kind`) after the error, so a listener can tell which publication failed.
  Existing single-argument listeners are unaffected.

## Bug Fixes

- Fixed a crash (`SIGSEGV`) during teardown of a Room that ended remotely. A remote track's
  frame sink was freed while still registered with the underlying WebRTC track, so the next
  frame delivered on an SDK-internal thread wrote through freed memory. Affected consumers
  using `RemoteAudioTrack.onFrame` or `RemoteVideoTrack.onFrame`.

- Data track options set to `undefined` are treated as unset. `{ maxRetransmits: undefined }`
  previously failed with `A number was expected`.

- Joining a Room that already had participants in it no longer misses their track
  events. `trackSubscribed`, `trackEnabled`, `trackDisabled`, `trackPublished`, and
  `trackUnpublished` were never emitted for participants who were already present.
  Participants who joined later were unaffected.

- Room now re-emits `trackSubscriptionFailed`. It was the only `RemoteParticipant` track
  event the Room did not forward, so `room` listeners never saw subscription failures.

# 1.0.0-preview.2 (July 23, 2026)

## Breaking Changes

- Room no longer emits a `connected` event. The underlying native signal was always
  one-shot and consumed internally to resolve `connect()`'s promise before the Room
  was returned, so a `room.on('connected', ...)` listener could never fire. TypeScript
  consumers with such a listener will see a compile error and should remove it;
  plain JavaScript consumers are unaffected.
