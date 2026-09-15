# Object lifecycle

Who owns which objects, what `disconnect()` and `dispose()` each release, and
the ordering the SDK guarantees while a Room tears down.
[README.md](README.md) covers usage, and
[FRAME_CONTRACT.md](FRAME_CONTRACT.md) covers frame delivery.

## What you own

Local tracks are the only SDK objects you construct. Everything else is handed
to you by the Room that produced it: participants, remote tracks, and `frames()`
iterators, all released by `room.dispose()`. Local tracks stay yours. They have
no release method, and disposing the Room does not touch them.

Each Room caches its remote track wrappers by Track SID, so a `trackSubscribed`
event and a read of `publication.track` give you the same object, and the
`frames()` iterator running on it is the one the SDK ends. The cache entry is
dropped when the track is unsubscribed or the Room tears down, so a read after
that point mints a fresh wrapper. Two Rooms subscribed to the same publication
each get their own wrapper.

`participant.videoTracks` and `participant.audioTracks` hold publications, not
tracks; `publication.track` is what resolves through the cache.

## Ending a Room

`room.disconnect()` leaves the session and returns right away; the
`disconnected` event follows. The Room object stays readable, but it still holds
the native resources behind it, so the process does not exit on its own.

`room.dispose()` releases everything the Room owns: participant wrappers, active
`frames()` iterators, the native Room, and every listener. It disconnects first if the
session is still up, so `dispose()` on its own is a complete teardown. A
disposed Room is no longer usable.

Call either one more than once, in either order, without harm.

The `disconnected` event is the clearest place to dispose:

```js
room.on('disconnected', () => {
  room.dispose();
});
```

Calling `disconnect()` or `dispose()` from inside that handler is supported, as
it is from any other Room or Participant event handler. You do not need to defer
the call to a later tick. One consequence to plan for: disposing from a handler
discards Room events still queued behind the one you are handling, such as a
`participantDisconnected` that a remotely ended Room raised at the same moment.
If your application needs those events, let the handler return and dispose on a
later tick.

A handler that throws stops that delivery, the way a throwing `EventEmitter`
listener stops an `emit`. The exception reaches the process as an
`uncaughtException`, and the events queued behind it are delivered afterward.

## Ending a receiver

A `frames()` iterator ends on its own when the track is unsubscribed or the Room
disconnects, so a `for await` loop exits instead of hanging. Leaving the loop
ends it early.

Once a receiver ends, its frames stop: the SDK unregisters the sink and closes
it, so a frame in flight on a decoder thread is dropped, and frames already
queued for the JavaScript thread are discarded rather than delivered. This holds
after a remote Room end as well, when there is no longer a media track to
unregister from.

Ending a receiver is idempotent, and safe from inside a `trackUnsubscribed`
handler: the SDK ends the receiver itself as soon as that handler returns.

`track.getStats()` keeps reporting the final counts after a receiver ends, for
as long as you hold that track wrapper. A wrapper minted after the cache entry
was dropped has no history and reports zeros.

## Event sequencing

The SDK guarantees this ordering during teardown:

- `trackUnsubscribed` arrives before the SDK ends that track's receiver, so the
  handler still sees a live track. This holds while the Room is up. If the Room
  ends at the same moment, the `disconnected` path may end every receiver and
  drop the wrapper cache first, and the `trackUnsubscribed` that follows carries
  a fresh wrapper with no receiver and zeroed stats: Room events and
  per-participant events ride independent queues with no ordering between them.
- `participantDisconnected` arrives after every `trackUnsubscribed` raised for
  that participant's tracks.
- `disconnected` arrives after every active receiver has ended, so a `for await`
  loop is guaranteed to exit rather than hang on a dead Room. The handler still
  runs first: ending a receiver resolves its parked `next()` promise, and the
  loop resumes on a later microtask. Results a loop tallies as it finishes are
  not final while the `disconnected` handler is running.

A track supports one receiver at a time, and `frames()` throws while one is
active. Starting a second receiver after the first ended works only while the
track is still subscribed. Once the track has been released, `frames()` returns
an iterator that never yields and never completes.
