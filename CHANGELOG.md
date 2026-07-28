This SDK is currently in beta. See the [README](README.md) for details.

# 1.0.0-preview.3 (Unreleased)

## Bug Fixes

- Joining a Room that already had participants in it no longer misses their track
  events. `trackSubscribed`, `trackEnabled`, and `trackDisabled` were never emitted for
  participants who were already present. Participants who joined later were unaffected.

# 1.0.0-preview.2 (July 23, 2026)

## Breaking Changes

- Room no longer emits a `connected` event. The underlying native signal was always
  one-shot and consumed internally to resolve `connect()`'s promise before the Room
  was returned, so a `room.on('connected', ...)` listener could never fire. TypeScript
  consumers with such a listener will see a compile error and should remove it;
  plain JavaScript consumers are unaffected.
