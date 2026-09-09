This SDK is currently in beta, and Linux x86-64 is the only supported platform.
See the [README](README.md) for details.

# 1.0.0-beta.1 (In Progress)

## Breaking Changes

### `frameId` is no longer accepted on published frames

`VideoFrameInput.frameId` and `AudioFrameInput.frameId` are removed. They were
typed and documented as "carried for tracing", but the publish path never read
them, so the value was silently discarded. `frameId` on _received_ frames is
unaffected: it is SDK-generated and monotonic per track.

```js
// Before - frameId was accepted and dropped
track.write({ ...frame, frameId: n });

// After - carry your own correlation outside the frame
track.write(frame);
```

### `FrameStream` is no longer exported

It is the internal queue behind `frames()`. `frames()` returns an
`AsyncIterableIterator`, which is the whole contract; exporting the class made
its internal constructor part of the public API. `MAX_QUEUE_CEILING` is still
exported.

### `UnsupportedPlatformError` is now thrown

Importing the SDK on a platform the addon is not built for, with no local build
present, throws `UnsupportedPlatformError` naming the platform, instead of a
`NativeBindingLoadError` advising a build that cannot succeed. A local build in
`build/Release` or `build/Debug` is loaded first, so contributors who compiled
the addon themselves on an unlisted platform are not blocked; an installed
package never has one, because `files` excludes `build/`.

`TwilioErrorClass`, the constructor shape shared by every error subclass, is now
exported as a type, and every exported error class exposes the static `code`
that shape requires - `NativeBindingLoadError` included.

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

Any `EventEmitter` registration method works: `on`, `once`, `addListener`,
`prependListener`, `prependOnceListener`.

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
fire-and-forget `send()` cannot produce an unhandled rejection. A send still in
flight when the track is destroyed resolves with `ok: false` rather than being
left pending.

```js
const result = await track.send('hello');
if (!result.ok) console.warn('send failed:', result.error);
```

### Audio publish is bounded, and rejects rather than sheds

`LocalAudioTrack.write()` previously buffered up to **45 seconds** of audio and
always returned `true`. The queue is now bounded (~500 ms by default,
configurable through `source.maxQueue` in 10 ms chunks) and a write is accepted
only if it fits whole in the remaining space. When it does not fit, nothing is
buffered and `write()` returns `false`. A producer running at real-time cadence
is unaffected; one running faster now learns it is outrunning the wire instead
of silently accumulating latency.

A single `write()` larger than `maxQueue` can never fit and is always rejected,
so size `maxQueue` to the largest burst you intend to publish. A caller that
handed `write()` a whole utterance at once previously had the front of it
discarded silently; it now gets `false` and can resize the queue or split the
write.

### `source.mode` and `source.drop` are removed from audio track options

`RawAudioSourceOptions` no longer accepts `mode` or `drop`. Both were validated
and then discarded: the publish queue lives in the process-wide audio device,
which has one policy and cannot express a per-track one. `source.maxQueue` is
kept and now documents that it binds that shared device, so the most recent
value passed to `createLocalAudioTrack` applies to every local audio track in
the process. `mode`, `maxQueue` and `drop` on the receive side (`frames()`) are
unchanged and remain per-track.

### `AudioFrameInput.timestamp` is observability-only

Audio publish is FIFO: the audio device emits queued samples on its own 10 ms
cadence. The `timestamp` on a published audio frame feeds
`WriteStats.lastTimestamp` and `WriteStats.timestampRegressions` and does not
change what is sent or when. Video publish still carries the timestamp through
to the encoded frame. This documents existing behavior; nothing changed in the
publish path.

- `trackSubscribed` and `trackUnsubscribed` now pass the track's `RemoteTrackPublication`.
  Listeners receive `(track, publication)` on a `RemoteParticipant` and
  `(track, publication, participant)` on a `Room`, matching twilio-video.js. Update any
  listener that took `(track, participant)` on a Room. On `trackUnsubscribed` the publication
  reports `isSubscribed: false` and its `track` is `undefined`, as documented for
  `RemoteTrackPublication`; the unsubscribed track is the event's first argument.
- An event listener that throws now surfaces the error instead of being silently ignored. An
  application relying on the previous behavior will start seeing `uncaughtException`.

### Remote track events carry a `RemoteTrackPublication`

These four events passed a plain `{ trackSid, trackName }` record (plus `isSubscribed` on the
state events). They now pass the same `RemoteTrackPublication` the track collections return,
matching twilio-video.js and the `trackSubscribed` events. `trackSubscriptionFailed` carries one
too, in place of its own `{ trackSid, trackName, kind }` record. `RemoteTrackPublishEvent`,
`RemoteTrackStateEvent` and `RemoteTrackSubscriptionFailedEvent` are no longer exported.

```js
// Before - a record, with no way to reach the track
participant.on('trackPublished', pub => console.log(pub.trackSid));

// After - a publication, with kind, enabled state and the track once subscribed
participant.on('trackPublished', pub => {
  console.log(pub.trackSid, pub.kind, pub.isTrackEnabled, pub.isSubscribed);
  if (pub.isSubscribed) pub.track.frames();
});
```

### `disconnected` passes the Room first

Listeners receive `(room, error?)` instead of `(error?)`, matching twilio-video.js.

```js
// Before
room.on('disconnected', error => { ... });

// After
room.on('disconnected', (room, error) => { ... });
```

### `trackPublicationFailed` passes the track that failed

Listeners receive `(error, localTrack?)` instead of `(error)`. `localTrack` is the instance
passed to `publishTrack()`, or `undefined` when the failure cannot be attributed to a track
this participant still holds.

```js
// Before
localParticipant.on('trackPublicationFailed', error => { ... });

// After
localParticipant.on('trackPublicationFailed', (error, localTrack) => { ... });
```

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
- The published type declarations no longer carry the SDK's `@internal`
  members. `_native`, `_attachFrameSink`, `_end` and the rest were annotated
  `@internal` but still landed in `index.d.ts`, so they appeared in consumer
  autocomplete as though they were API. None was documented or supported.
- `VideoFrame.close()` / `AudioFrame.close()` release the buffers promptly.
  Optional - the frame is an owned copy and GC reclaims it. Idempotent; reading
  plane data after `close()` throws.
- `CreateLocalVideoTrackOptions.source` pins the frame size, so a mismatched
  frame is rejected rather than silently rescaled.
  `CreateLocalAudioTrackOptions.source` bounds the publish queue.
- `ConnectOptions.connectionTimeout` (default 30s) rejects with
  `RoomConnectTimeoutError`. There was previously no timeout at any layer, so a
  wedged connect hung the caller indefinitely.
- One error subclass per known Twilio code, 26 in all, plus typed SDK-local
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
- `trackSubscribed` is now emitted for tracks a remote participant was already publishing when
  they joined. The observer the media engine calls is installed as soon as the participant
  connects, rather than one thread hop later, which is after the subscription has already
  completed. Rejoining participants were the most affected: the first join often reported its
  tracks and later ones silently did not.
- An exception thrown by an event listener is no longer swallowed. It is reported as an
  `uncaughtException`, and events queued behind it are retained so an application that handles
  `uncaughtException` still receives them. Previously such an error produced no output at all,
  which was indistinguishable from an event that was never emitted.
- `trackUnsubscribed` is now emitted for every track a participant was still publishing when they
  disconnected. It could previously be lost because it and `participantDisconnected` were
  delivered on independent internal queues with no guaranteed order between them.
- Fixed several cases where a `RemoteParticipant` stopped receiving further track events after
  the SDK built a second internal wrapper for it, which happened on reading `room.participants`
  or `room.dominantSpeaker`, on a reconnect, or for a participant who was already in the Room
  when the local participant connected. Reading `room.participants` even once after a
  participant connected could permanently stop delivery of `trackSubscribed`,
  `trackUnsubscribed`, and related events for that participant, with no error.
- Fixed the equivalent issue for `RemoteDataTrack`: reading a participant's `dataTracks` (or
  `tracks`) a second time could stop message delivery to a `RemoteDataTrack` object obtained
  from an earlier read. Every independently obtained `RemoteDataTrack` for the same underlying
  track now receives messages, matching how multiple `RemoteVideoTrack`/`RemoteAudioTrack`
  objects for the same track already each receive frames.
- A participant is no longer kept in memory for the rest of the Room's lifetime after they
  disconnect. Their cached wrapper was previously released only as a side effect of a later
  `room.participants` read; an application that only listens to events, without reading that
  getter, retained every departed participant until the Room itself was disposed.
- `participantDisconnected` now arrives after that participant's final `trackUnsubscribed`
  events, and is emitted from the Room's own event queue so it stays in order with Room events
  raised before it, such as `dominantSpeakerChanged`. It is not ordered against a Room event
  raised in the same moment: a Room that ends as a participant leaves can report `disconnected`
  first, and an application that calls `room.dispose()` from that handler may not receive the
  `participantDisconnected` at all.
- `participantDisconnected` now reports the same `RemoteParticipant` object the application
  already received from `participantConnected` or `room.participants`. A `room.participants`
  read while the participant was leaving dropped the cached instance, so the event carried a
  second one: a listener attached to the original never saw the disconnect, and that original
  was never disposed.
- Fixed a crash during teardown when an event listener disposes the Room it is handling an
  event for. The internal event queue continued to touch its own state after the listener
  returned, which the `dispose()` had already freed.
- A `RemoteDataTrack` no longer delivers a message after `trackUnsubscribed` has been emitted
  for it. A message that was already on its way to the JS thread when the track was
  unsubscribed is now dropped, matching the documented contract.
- Two Rooms in the same process subscribed to the same published data track now each receive
  messages. They were keyed by Track SID, which is shared between them, so only the first Room
  received messages and tearing that Room down stopped delivery for the other one.
- Data track observers are no longer retained for the process's lifetime. They were released
  only when a track was explicitly unsubscribed, so any other teardown, such as disposing a
  Room mid-call, left them behind.

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
