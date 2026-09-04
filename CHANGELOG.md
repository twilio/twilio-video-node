This SDK is currently in beta. See the [README](README.md) for details.

# Unreleased

## Bug Fixes

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
- `participantDisconnected` is now delivered in order with the Room's other events, such as
  the `dominantSpeakerChanged` that precedes it and the `disconnected` that can follow, while
  still arriving after that participant's final `trackUnsubscribed` events. It also survives a
  concurrent `room.participants` read, which prunes the departing participant and could
  previously discard the event before it reached a listener.
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

## Breaking Changes

- `trackSubscribed` and `trackUnsubscribed` now pass the track's `RemoteTrackPublication`.
  Listeners receive `(track, publication)` on a `RemoteParticipant` and
  `(track, publication, participant)` on a `Room`, matching twilio-video.js. Update any
  listener that took `(track, participant)` on a Room. On `trackUnsubscribed` the publication
  reports `isSubscribed: false` and its `track` is `undefined`, as documented for
  `RemoteTrackPublication`; the unsubscribed track is the event's first argument.
- An event listener that throws now surfaces the error instead of being silently ignored. An
  application relying on the previous behavior will start seeing `uncaughtException`.

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
