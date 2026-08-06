This SDK is currently in beta. See the [README](README.md) for details.

# 1.0.0-preview.3 (Unreleased)

## Breaking Changes

- `LocalDataTrack.maxPacketLifeTime` and `maxRetransmits` are now `number | null`, reporting
  `null` when unset instead of `65535`. Check for `null`, or use `reliable`. Both now report the
  value passed to `createLocalDataTrack()`, so a limit of `65535` reads back as `65535`.

- `createLocalDataTrack()` validates delivery options. `maxPacketLifeTime` and `maxRetransmits`
  must be integers in `[0, 65535]` (`RangeError`, replacing the plain `Error` for negatives);
  `ordered` must be a boolean (`TypeError`). Invalid values were previously coerced.

## Features

- `RemoteDataTrack` exposes `maxPacketLifeTime` and `maxRetransmits`, so a subscriber can tell
  how the publisher configured delivery. A publisher's limit of `65535` reads back as `null`,
  since a subscribed track reports it the same way it reports an unset limit.

- `LocalDataTrackOptions.maxPacketLifeTime` and `maxRetransmits` accept `null`, so a value read
  off a track can be passed back into `createLocalDataTrack()`.

## Bug Fixes

- Data track options set to `undefined` are treated as unset. `{ maxRetransmits: undefined }`
  previously failed with `A number was expected`.

- Joining a Room that already had participants in it no longer misses their track
  events. `trackSubscribed`, `trackEnabled`, `trackDisabled`, `trackPublished`, and
  `trackUnpublished` were never emitted for participants who were already present.
  Participants who joined later were unaffected.

- Room now re-emits `trackSubscriptionFailed` (with the participant appended), matching
  the rest of the `RemoteParticipant` track events it already bubbles.

# 1.0.0-preview.2 (July 23, 2026)

## Breaking Changes

- Room no longer emits a `connected` event. The underlying native signal was always
  one-shot and consumed internally to resolve `connect()`'s promise before the Room
  was returned, so a `room.on('connected', ...)` listener could never fire. TypeScript
  consumers with such a listener will see a compile error and should remove it;
  plain JavaScript consumers are unaffected.
