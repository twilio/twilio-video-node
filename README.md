# @twilio/video-node-sdk

[![CI](https://github.com/twilio/twilio-video-node/actions/workflows/ci.yml/badge.svg)](https://github.com/twilio/twilio-video-node/actions/workflows/ci.yml)

Server-side Node.js SDK for Twilio Video Group Rooms with raw media frame access. Built on a native C++ addon over WebRTC, it lets you push and receive decoded video and audio frames from Node.js on realtime.

**Note: this is a beta release of the Twilio Media SDK for Node.js. It is provided for evaluation purposes only and should not be used with production traffic. During the beta period this SDK is not HIPAA eligible.**

## Installation

Install the provided `.tgz` file directly:

```bash
npm install ./twilio-video-node-sdk-<version>.tgz
```

The native binary is prebuilt and bundled — no build step required. Import it as `@twilio/video-node-sdk`.

**Requirements:**

- Node.js >= 24
- Linux x64, or macOS on x64 Node

> **Apple Silicon (M-series) Macs:** The native binary is x64-only. Install Rosetta once (`softwareupdate --install-rosetta`) and run an x64 Node so `process.arch` is `x64` (e.g. `arch -x86_64 node ...`, or an x64 Node selected via `nvm`). Installing under native arm64 Node fails with `npm error code EBADPLATFORM`.

### Access Token

The `connect()` function takes a standard Twilio Video Access Token with a
VideoGrant, the same token format used by the JavaScript SDK. Generate one
using the [`twilio`](https://www.npmjs.com/package/twilio) helper library. See
[User Identity and Access Tokens](https://www.twilio.com/docs/video/tutorials/user-identity-access-tokens)
for details.

## Quick Start

```js
const { connect, createLocalVideoTrack } = require('@twilio/video-node-sdk');

async function main() {
  const videoTrack = createLocalVideoTrack('my-camera');

  const room = await connect(token, {
    name: 'my-room',
    videoTracks: [videoTrack],
  });

  console.log('Connected:', room.name, room.sid);

  // Push I420 video frames. connect() resolves only once the Room is connected;
  // frames written before that are dropped and counted in getWriteStats().
  videoTrack.write({
    format: 'I420',
    width: 1280,
    height: 720,
    y: { data: yPlane, stride: 1280, width: 1280, height: 720 },
    u: { data: uPlane, stride: 640, width: 640, height: 360 },
    v: { data: vPlane, stride: 640, width: 640, height: 360 },
  });

  async function trackSubscribed(track) {
    if (track.kind !== 'video') return;
    // Awaiting each frame is the backpressure. The loop ends by itself when the
    // track is unsubscribed or the Room disconnects.
    for await (const frame of track.frames()) {
      console.log(`${frame.width}x${frame.height} @ ${frame.timestamp}us`);
      frame.close?.();
    }
  }

  function participantConnected(participant) {
    participant.on('trackSubscribed', trackSubscribed);

    participant.tracks.forEach(publication => {
      if (publication.isSubscribed) {
        trackSubscribed(publication.track);
      }
    });
  }

  // participantConnected does not fire for participants already in the Room, and a
  // track can finish subscribing before this listener is attached. Seed from
  // room.participants and check isSubscribed on the publications found there.
  room.participants.forEach(participantConnected);
  room.on('participantConnected', participantConnected);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
```

## Differences from the JavaScript SDK

This SDK shares the same Room/Participant/Track model and event names as the
[Twilio Video JavaScript SDK](https://www.twilio.com/docs/video/javascript),
but is designed for server-side media processing rather than browser-based
conferencing. Key differences:

- **No device capture.** `createLocalVideoTrack()` and `createLocalAudioTrack()`
  return pushable tracks with no media constraints. You supply raw frames via
  `track.write()` instead of capturing from a camera or microphone.

- **No rendering.** There is no `track.attach(element)`. Remote media arrives as
  raw decoded frames (I420 video, PCM audio) through
  `for await (const frame of track.frames())`.

- **Fixed audio input format.** `LocalAudioTrack.write()` accepts only 48 kHz
  mono S16LE PCM. Received audio may vary in sample rate and channel count.

- **No adaptive simulcast or track priority.** Published video tracks always use
  standard priority with simulcast disabled; the deprecated `TrackPriority` API
  is not exposed. Bandwidth and remote render-size hints are configurable
  instead via `bandwidthProfile`, `encodingParameters`, and
  `RemoteVideoTrack.setContentPreferences()`.

- **Synchronous track creation.** `createLocalVideoTrack()` returns a track
  immediately (no async device permissions). Tracks can be passed to `connect()`
  or published later via `localParticipant.publishTrack()`.

## API Overview

### Top-level Functions

| Function                                 | Description                                                                                                                                                                                                                                                                                  |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connect(token, options?)`               | Connect to a room. Returns `Promise<Room>`.                                                                                                                                                                                                                                                  |
| `createLocalVideoTrack(name?)`           | Create a pushable local video track.                                                                                                                                                                                                                                                         |
| `createLocalAudioTrack(name?)`           | Create a pushable local audio track.                                                                                                                                                                                                                                                         |
| `createLocalDataTrack(name \| options?)` | Create a local data track. Options are `name`, `ordered`, and one of `maxPacketLifeTime`/`maxRetransmits`.                                                                                                                                                                                   |
| `createLocalTracks(options?)`            | Create local audio and/or video tracks. With no options, returns both. If either `audio` or `video` is specified, the other defaults to `false`. Each key accepts `true`/`false` or a per-track options object (e.g. `{ name }`). Returns `Promise<(LocalAudioTrack \| LocalVideoTrack)[]>`. |
| `twilioErrorFromCode(code, message?)`    | Build a `TwilioError` (or matching subclass) from a numeric error code.                                                                                                                                                                                                                      |
| `setLogLevel(level)`                     | Set native log level. Accepts a name (`'off'` \| `'fatal'` \| `'error'` \| `'warning'` \| `'info'` \| `'debug'` \| `'trace'` \| `'all'`) or the equivalent number `0` (off) through `7` (all).                                                                                               |
| `getVersion()`                           | Returns the native SDK version string.                                                                                                                                                                                                                                                       |

### Key Classes

| Export                   | Description                                                                                                                                                      |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Room`                   | A connected video room. Emits events, exposes participants.                                                                                                      |
| `LocalParticipant`       | The local participant. Publish/unpublish tracks.                                                                                                                 |
| `RemoteParticipant`      | A remote participant. Emits `trackSubscribed`/`trackUnsubscribed`.                                                                                               |
| `LocalVideoTrack`        | Pushable video track (`write(frame)`).                                                                                                                           |
| `LocalAudioTrack`        | Pushable audio track (`write(frame)`, `clearBuffer()`).                                                                                                          |
| `LocalDataTrack`         | Send arbitrary data (`send`). Create via `createLocalDataTrack(name \| options?)`.                                                                               |
| `RemoteVideoTrack`       | Receive video frames (`frames()`), `getStats()`, `frameDropped` event.                                                                                           |
| `RemoteAudioTrack`       | Receive audio frames (`frames()`), `getStats()`, `frameDropped` event.                                                                                           |
| `RemoteDataTrack`        | Receive data messages (`message` event).                                                                                                                         |
| `TrackPublication`       | Base class for published tracks (`trackSid`, `trackName`, `kind`, `isTrackEnabled`).                                                                             |
| `LocalTrackPublication`  | Local publication. Exposes `track` and `unpublish()`. Subclassed per kind (`LocalVideoTrackPublication`, …).                                                     |
| `RemoteTrackPublication` | Remote publication. Exposes `track` and `isSubscribed`. Subclassed per kind (`RemoteVideoTrackPublication`, …).                                                  |
| `TwilioError`            | Base error class, carrying a numeric `code`. One subclass per known Twilio code, plus SDK-local errors (`NativeBindingLoadError`, `RoomConnectTimeoutError`, …). |
| `ErrorCode`              | Enum of Twilio Video error codes.                                                                                                                                |

## Room Events

### Room state at connect

`participantConnected` is not emitted for participants who were already in the Room when
`connect()` resolved. They are part of the Room's starting state: read them from
`room.participants`.

A participant who was already publishing emits `trackSubscribed` after `connect()` resolves.
Subscriptions that completed before the listener was attached are not replayed, and appear in
`participant.tracks` with `isSubscribed` set to `true`.

| Event                     | Handler Signature                                  |
| ------------------------- | -------------------------------------------------- |
| `disconnected`            | `(error?: TwilioError) => void`                    |
| `connectFailure`          | `(error: TwilioError) => void`                     |
| `reconnecting`            | `(error?: TwilioError) => void`                    |
| `reconnected`             | `() => void`                                       |
| `participantConnected`    | `(participant: RemoteParticipant) => void`         |
| `participantDisconnected` | `(participant: RemoteParticipant) => void`         |
| `participantReconnecting` | `(participant: RemoteParticipant) => void`         |
| `participantReconnected`  | `(participant: RemoteParticipant) => void`         |
| `recordingStarted`        | `() => void`                                       |
| `recordingStopped`        | `() => void`                                       |
| `dominantSpeakerChanged`  | `(participant: RemoteParticipant \| null) => void` |
| `transcription`           | `(transcriptionJson: string) => void`              |

The Room re-emits every track event in [RemoteParticipant Events](#remoteparticipant-events),
appending the `RemoteParticipant` that emitted it as the last argument. Handle every
participant's tracks from one place instead of attaching a listener to each participant.

### RemoteParticipant Events

| Event                        | Handler Signature                                                               |
| ---------------------------- | ------------------------------------------------------------------------------- |
| `trackSubscribed`            | `(track: RemoteVideoTrack \| RemoteAudioTrack \| RemoteDataTrack) => void`      |
| `trackUnsubscribed`          | `(track: RemoteVideoTrack \| RemoteAudioTrack \| RemoteDataTrack) => void`      |
| `trackSubscriptionFailed`    | `(error: TwilioError, publication: RemoteTrackSubscriptionFailedEvent) => void` |
| `trackPublished`             | `(publication: RemoteTrackPublishEvent) => void`                                |
| `trackUnpublished`           | `(publication: RemoteTrackPublishEvent) => void`                                |
| `trackEnabled`               | `(publication: RemoteTrackStateEvent) => void`                                  |
| `trackDisabled`              | `(publication: RemoteTrackStateEvent) => void`                                  |
| `videoTrackSwitchedOff`      | `(track: RemoteVideoTrack) => void`                                             |
| `videoTrackSwitchedOn`       | `(track: RemoteVideoTrack) => void`                                             |
| `networkQualityLevelChanged` | `(level: number) => void`                                                       |

### LocalParticipant Events

| Event                        | Handler Signature                              |
| ---------------------------- | ---------------------------------------------- |
| `trackPublished`             | `(publication: LocalTrackPublication) => void` |
| `trackPublicationFailed`     | `(error: TwilioError) => void`                 |
| `networkQualityLevelChanged` | `(level: number) => void`                      |

### TrackPublication

`LocalTrackPublication` exposes `track` (the local track instance) and an `unpublish()` method:

```js
const pub = room.localParticipant.tracks.get(trackSid); // LocalTrackPublication
pub.unpublish(); // unpublishes the underlying track
```

`RemoteTrackPublication` exposes `track` (the subscribed remote track, if any) and `isSubscribed`.

### Room.getStats()

Returns a snapshot of WebRTC stats per peer connection. Rejects if the room is disconnected.

```js
const reports = await room.getStats();
// reports[i]: {
//   peerConnectionId, localAudioTrackStats, localVideoTrackStats,
//   remoteAudioTrackStats, remoteVideoTrackStats
// }
```

## Track Types

### LocalVideoTrack

Push raw I420 video frames into a room. Frames written before `connect()` resolves are dropped, and counted in `getWriteStats()`.

```js
const track = createLocalVideoTrack('camera');
track.write({
  format: 'I420', // optional; only 'I420' is accepted
  width,
  height, // both must be positive and even
  y: { data: yBuffer, stride: yStride, width, height },
  u: { data: uBuffer, stride: uStride, width: width / 2, height: height / 2 },
  v: { data: vBuffer, stride: vStride, width: width / 2, height: height / 2 },
  timestamp, // optional microseconds; defaults to monotonic now
  rotation, // optional 0 | 90 | 180 | 270
});
track.enabled = false; // mute
```

Buffers are copied synchronously, so they can be reused as soon as `write()` returns.

`write()` returns `false` when the frame was dropped rather than encoded - most often because the encoder sink has not attached yet, but also when libwebrtc's adapter rate-limits or rejects the resolution. It throws `TypeError`/`RangeError` on invalid input.

Optionally pin the frame size at creation, so a mismatched frame is rejected instead of silently rescaled:

```js
const track = createLocalVideoTrack({
  name: 'camera',
  source: { type: 'raw', format: 'I420', width: 1280, height: 720, fps: 30 },
});
```

Publish-side counters:

```js
const { framesWritten, framesDropped, sendQueueDepth, maxQueue, lastTimestamp } =
  track.getWriteStats();
```

Video publish is synchronous - `write()` hands the frame straight to the encoder - so there is no SDK-side send queue and `sendQueueDepth`/`maxQueue` are always `0`. A `framesDropped` here means the frame was rejected, not shed from a queue.

### LocalAudioTrack

Push raw PCM audio samples into a room. Format is fixed to **48kHz mono S16LE**.

```js
const track = createLocalAudioTrack('mic');
const accepted = track.write({
  pcm, // Buffer of interleaved int16 samples
  frames, // samples per channel, e.g. 480 for a 10ms chunk
  timestamp, // optional microseconds
});
```

Unlike video, audio publish has a real send queue, drained one 10 ms chunk at a
time. It is bounded (~100 ms by default) so a producer running faster than real
time sheds the oldest samples instead of accumulating latency. `write()` returns
`false` for a chunk that caused shedding, and every drop is counted:

```js
const track = createLocalAudioTrack({
  name: 'mic',
  // maxQueue is in 10ms chunks: 20 => ~200ms of smoothing.
  source: { type: 'raw', format: 'PCM_S16LE', sampleRate: 48000, channels: 1, maxQueue: 20 },
});
const { framesWritten, framesDropped, sendQueueDepth, maxQueue } = track.getWriteStats();
```

Publishing at real-time cadence should never drop. A non-zero `framesDropped`
means the producer is outrunning the wire.

`clearBuffer()` discards whatever is still queued and not yet sent. Use it when
the queued audio has become stale rather than merely late - barge-in, where the
speaker is interrupted and the rest of the utterance should never play, is the
usual case. Writes after it resume from an empty queue.

```js
track.clearBuffer();
```

### LocalDataTrack

Send arbitrary string or binary messages. Delivery is reliable and ordered by default.

```js
const track = createLocalDataTrack({ name: 'chat', ordered: true });
room.localParticipant.publishTrack(track);
track.send('hello');
track.send(Buffer.from([0x01, 0x02]));

// send() reports the outcome. The promise always resolves - never rejects - so
// a fire-and-forget send cannot produce an unhandled rejection.
const result = await track.send('important');
if (!result.ok) console.warn('send failed:', result.error);
```

Messages larger than **64 KB** (`kMaxMessageSize`) are rejected synchronously
with a `RangeError` and never transmitted.

Pass `maxPacketLifeTime` (milliseconds) or `maxRetransmits` (a count) to trade reliability for
latency. The two are mutually exclusive, and each must be an integer from 0 to 65535.

```js
const telemetry = createLocalDataTrack({ name: 'telemetry', maxPacketLifeTime: 500 });
telemetry.maxPacketLifeTime; // 500
telemetry.maxRetransmits; // null
telemetry.reliable; // false
```

`maxPacketLifeTime` and `maxRetransmits` are `number | null`, reading back as `null` when the
limit was not set. `reliable` is `true` only when neither is set.

### RemoteVideoTrack

Receive decoded I420 video frames from a remote participant.

```js
for await (const frame of track.frames()) {
  // frame: {
  //   format: 'I420',
  //   width, height,
  //   y, u, v,                  // I420Plane: { data: Buffer, stride, width, height }
  //   timestamp: number,        // microseconds
  //   captureTimestamp?: number,
  //   rtpTimestamp?: number,
  //   frameId: number,          // SDK-generated, monotonic per track
  //   rotation?: 0 | 90 | 180 | 270,
  //   close?(): void,           // optional prompt release
  // }
  frame.close?.();
}
// The loop ends on unsubscribe or Room disconnect. `break` releases the track.

// Hint the desired render dimensions to the SFU. Width/height must be positive
// integers. Only takes effect when the room was connected with a
// bandwidthProfile that has `contentPreferencesMode: 'manual'`.
track.setContentPreferences({ renderDimensions: { width: 320, height: 240 } });

// `isSwitchedOff` is `true` when the SFU has stopped delivering this track
// (e.g. due to bandwidth-profile constraints). Pair with the
// `videoTrackSwitchedOff` / `videoTrackSwitchedOn` events on RemoteParticipant.
track.isSwitchedOff;
```

### RemoteAudioTrack

Receive decoded PCM audio frames from a remote participant.

```js
for await (const frame of track.frames()) {
  // frame: {
  //   format: 'PCM_S16LE',
  //   sampleRate, channels, frames,
  //   pcm: Buffer,              // interleaved int16 samples
  //   timestamp: number,        // microseconds
  //   frameId: number,          // SDK-generated, monotonic per track
  //   close?(): void,
  // }
}
```

### RemoteDataTrack

Receive string or binary messages from a remote participant.

```js
track.on('message', data => {
  /* string | Buffer */
});
```

`maxPacketLifeTime`, `maxRetransmits`, `reliable`, and `ordered` report how the publisher
configured delivery. A publisher's limit of `65535` reads back as `null`, because a subscribed
track reports it the same way it reports an unset limit; `reliable` still distinguishes the two.

For the precise guarantees - buffer ownership, where frames are dropped, drop
policy and ordering, timestamp rules, and the publish invariants - see
[FRAME_CONTRACT.md](FRAME_CONTRACT.md).

## Frame Formats

### Video (`VideoFrame` / `VideoFrameInput`)

I420 planar layout. Each plane is an `I420Plane`: `{ data: Buffer, stride, width, height }`, where `stride` is bytes per row (≥ the plane's width, padded for alignment).

| Plane | Logical size             | `data` size             | Description      |
| ----- | ------------------------ | ----------------------- | ---------------- |
| Y     | `width × height`         | `y.stride × height`     | Luminance        |
| U     | `⌈width/2⌉ × ⌈height/2⌉` | `u.stride × ⌈height/2⌉` | Chrominance (Cb) |
| V     | `⌈width/2⌉ × ⌈height/2⌉` | `v.stride × ⌈height/2⌉` | Chrominance (Cr) |

Publish and receive use the **same** planar shape: each of `y`/`u`/`v` is an `I420Plane` (`{ data, stride, width, height }`). A received frame can be written straight back out without reshaping.

Timestamps are plain numbers of **microseconds** (`timestamp`). Microsecond resolution stays exact in a JS number for roughly 285 years, and the underlying engine reports microseconds natively. `rotation` is `0 | 90 | 180 | 270`.

### Audio (`AudioFrame` / `AudioFrameInput`)

Interleaved 16-bit signed little-endian PCM in a single `Buffer`.

- **Inputs** to `LocalAudioTrack.write()` are fixed at **48kHz mono** — only `pcm` and `frames` are accepted.
- **Received `AudioFrame`s** include `sampleRate`, `channels`, `frames`, `pcm`, `timestamp` (microseconds), and `frameId`.

## Configuration

### ConnectOptions

```ts
{
  name?: string;                        // Room name
  videoTracks?: LocalVideoTrack[];      // Tracks to publish on connect
  audioTracks?: LocalAudioTrack[];
  dataTracks?: LocalDataTrack[];
  enableInsights?: boolean;
  enableAutomaticSubscription?: boolean;
  enableDominantSpeaker?: boolean;
  networkQuality?: boolean | { local?: 1; remote?: 0 | 1 };
  preferredAudioCodecs?: ('opus' | 'PCMU')[];
  preferredVideoCodecs?: 'VP8'[];
  videoEncodingMode?: 'auto';
  bandwidthProfile?: BandwidthProfileOptions;
  receiveTranscriptions?: boolean;
  region?: string;                      // e.g. 'us1', 'au1'
  iceOptions?: IceOptions;
  encodingParameters?: EncodingParameters;
  connectionTimeout?: number;           // ms; default 30000, 0 waits indefinitely
}
```

### BandwidthProfileOptions

```ts
{
  video?: {
    mode?: 'collaboration' | 'grid' | 'presentation';
    maxSubscriptionBitrate?: number;    // bits per second
    trackSwitchOffMode?: 'detected' | 'predicted' | 'disabled';
    clientTrackSwitchOffControl?: 'auto' | 'manual';
    contentPreferencesMode?: 'auto' | 'manual';
  };
}
```

### EncodingParameters

```ts
{
  maxAudioBitrate?: number;             // bits per second
  maxVideoBitrate?: number;             // bits per second
}
```

### IceOptions

```ts
{
  transportPolicy?: 'all' | 'relay';  // 'relay' forces TURN
  iceServers?: IceServer[];           // { urls: string[]; username?: string; credential?: string }
}
```

## Platform Support

- **macOS** x64 (Apple Silicon via Rosetta)
- **Linux** x64
- **Node.js** >= 24.0.0

## Examples

See the [`examples/`](https://github.com/twilio/twilio-video-node/tree/main/examples) directory:

| Example                                                                                                 | Description                                                                                         |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [`virtual_camera.js`](https://github.com/twilio/twilio-video-node/blob/main/examples/virtual_camera.js) | Decodes an MP4 with ffmpeg and pushes I420 frames to a room.                                        |
| [`video_mirror.js`](https://github.com/twilio/twilio-video-node/blob/main/examples/video_mirror.js)     | Receives remote video frames and pushes them back as-is.                                            |
| [`audio_push.js`](https://github.com/twilio/twilio-video-node/blob/main/examples/audio_push.js)         | Generates a sine wave tone and pushes PCM audio to a room.                                          |
| [`data_channel.js`](https://github.com/twilio/twilio-video-node/blob/main/examples/data_channel.js)     | Two participants exchange string and binary messages via data tracks.                               |
| [`voice_agent.js`](https://github.com/twilio/twilio-video-node/blob/main/examples/voice_agent.js)       | Bridges room audio to the OpenAI Realtime API for a spoken voice agent (requires `OPENAI_API_KEY`). |

The examples load credentials from a `.env` file at the repo root. Copy the
template, fill in your credentials, and run:

```bash
cp .env.example .env
# edit .env: set TWILIO_ACCOUNT_SID / TWILIO_API_KEY / TWILIO_API_SECRET
node examples/virtual_camera.js [room-name]
```

`.env` is gitignored, so your real credentials are never committed.

## License

See [LICENSE.md](./LICENSE.md).
