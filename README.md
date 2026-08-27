# @twilio/video-node-sdk

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

  // Push I420 video frames (connect() only resolves once the room is connected;
  // frames pushed before that point would be silently dropped)
  videoTrack.write({
    y: yPlane,
    u: uPlane,
    v: vPlane,
    yStride: 1280,
    uStride: 640,
    vStride: 640,
    width: 1280,
    height: 720,
  });

  function trackSubscribed(track) {
    if (track.kind === 'video') {
      track.onFrame(frame => {
        console.log(`${frame.width}x${frame.height}`);
      });
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
  raw decoded frames (I420 video, PCM audio) via `track.onFrame(callback)`.

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

| Export                   | Description                                                                                                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Room`                   | A connected video room. Emits events, exposes participants.                                                                                                            |
| `LocalParticipant`       | The local participant. Publish/unpublish tracks.                                                                                                                       |
| `RemoteParticipant`      | A remote participant. Emits `trackSubscribed`/`trackUnsubscribed`.                                                                                                     |
| `LocalVideoTrack`        | Pushable video track (`write(frame)`).                                                                                                                                 |
| `LocalAudioTrack`        | Pushable audio track (`write(frame)`).                                                                                                                                 |
| `LocalDataTrack`         | Send arbitrary data (`send`). Create via `createLocalDataTrack(name \| options?)`.                                                                                     |
| `RemoteVideoTrack`       | Receive video frames (`onFrame`).                                                                                                                                      |
| `RemoteAudioTrack`       | Receive audio frames (`onFrame`).                                                                                                                                      |
| `RemoteDataTrack`        | Receive data messages (`onMessage`).                                                                                                                                   |
| `TrackPublication`       | Base class for published tracks (`trackSid`, `trackName`, `kind`, `isTrackEnabled`).                                                                                   |
| `LocalTrackPublication`  | Local publication. Exposes `track` and `unpublish()`. Subclassed per kind (`LocalVideoTrackPublication`, …).                                                           |
| `RemoteTrackPublication` | Remote publication. Exposes `track` and `isSubscribed`. Subclassed per kind (`RemoteVideoTrackPublication`, …).                                                        |
| `TwilioError`            | Base error class. Subclasses: `AccessTokenInvalidError`, `RoomNotFoundError`, `SignalingConnectionError`, `MediaConnectionError`, `ParticipantMaxTracksExceededError`. |
| `ErrorCode`              | Enum of Twilio Video error codes.                                                                                                                                      |

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

Push raw I420 video frames into a room. Frames pushed before `connect()` resolves are silently dropped.

```js
const track = createLocalVideoTrack('camera');
track.write({
  y,
  u,
  v, // Buffers
  yStride,
  uStride,
  vStride, // bytes per row
  width,
  height,
  timestampNs, // optional bigint, defaults to monotonic now
  rotation, // optional 0 | 90 | 180 | 270
});
track.enabled = false; // mute
```

`write()` returns `false` when the underlying source is unavailable (e.g. before the room is connected) and throws `TypeError`/`RangeError` on invalid input.

### LocalAudioTrack

Push raw PCM audio samples into a room. Format is fixed to **48kHz mono S16LE**.

```js
const track = createLocalAudioTrack('mic');
track.write({
  pcm, // Buffer of interleaved int16 samples
  frames, // number of samples
});
```

### LocalDataTrack

Send arbitrary string or binary messages. Delivery is reliable and ordered by default.

```js
const track = createLocalDataTrack({ name: 'chat', ordered: true });
room.localParticipant.publishTrack(track);
track.send('hello');
track.send(Buffer.from([0x01, 0x02]));
```

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
track.onFrame(frame => {
  // frame: {
  //   format: 'I420',
  //   width, height,
  //   y, u, v,                  // I420Plane: { data: Buffer, stride, width, height }
  //   timestampNs: bigint,
  //   captureTimestampNs?: bigint,
  //   rtpTimestamp?: number,
  //   frameId: number,
  //   rotation?: 0 | 90 | 180 | 270,
  // }
});
track.removeFrameCallback();

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
track.onFrame(frame => {
  // frame: {
  //   format: 'PCM_S16LE',
  //   sampleRate, channels, frames,
  //   pcm: Buffer,              // interleaved int16 samples
  //   timestampNs: bigint,
  //   frameId: number,
  // }
});
track.removeFrameCallback();
```

### RemoteDataTrack

Receive string or binary messages from a remote participant.

```js
track.onMessage(data => {
  /* string | Buffer */
});
track.removeMessageCallback();
```

`maxPacketLifeTime`, `maxRetransmits`, `reliable`, and `ordered` report how the publisher
configured delivery. A publisher's limit of `65535` reads back as `null`, because a subscribed
track reports it the same way it reports an unset limit; `reliable` still distinguishes the two.

## Frame Formats

### Video (`VideoFrame` / `VideoFrameInput`)

I420 planar layout. Each plane is a `Buffer`; `stride` is bytes per row (≥ width, padded for alignment).

| Plane | Logical size             | Buffer size            | Description      |
| ----- | ------------------------ | ---------------------- | ---------------- |
| Y     | `width × height`         | `yStride × height`     | Luminance        |
| U     | `⌈width/2⌉ × ⌈height/2⌉` | `uStride × ⌈height/2⌉` | Chrominance (Cb) |
| V     | `⌈width/2⌉ × ⌈height/2⌉` | `vStride × ⌈height/2⌉` | Chrominance (Cr) |

Inputs to `LocalVideoTrack.write()` use a flat `VideoFrameInput` shape (`y`/`u`/`v` Buffers + `yStride`/`uStride`/`vStride`); received `VideoFrame`s wrap each plane in an `I420Plane` (`{ data, stride, width, height }`).

Timestamps are **`bigint` nanoseconds** (`timestampNs`). `rotation` is `0 | 90 | 180 | 270`.

### Audio (`AudioFrame` / `AudioFrameInput`)

Interleaved 16-bit signed little-endian PCM in a single `Buffer`.

- **Inputs** to `LocalAudioTrack.write()` are fixed at **48kHz mono** — only `pcm` and `frames` are accepted.
- **Received `AudioFrame`s** include `sampleRate`, `channels`, `frames`, `pcm`, and `timestampNs: bigint`.

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

See the [`examples/`](examples/) directory:

| Example                                           | Description                                                                                         |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [`virtual_camera.js`](examples/virtual_camera.js) | Decodes an MP4 with ffmpeg and pushes I420 frames to a room.                                        |
| [`video_mirror.js`](examples/video_mirror.js)     | Receives remote video frames and pushes them back as-is.                                            |
| [`audio_push.js`](examples/audio_push.js)         | Generates a sine wave tone and pushes PCM audio to a room.                                          |
| [`data_channel.js`](examples/data_channel.js)     | Two participants exchange string and binary messages via data tracks.                               |
| [`voice_agent.js`](examples/voice_agent.js)       | Bridges room audio to the OpenAI Realtime API for a spoken voice agent (requires `OPENAI_API_KEY`). |

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
