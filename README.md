# twilio-video-sdk

Server-side Node.js SDK for Twilio Video Group Rooms with raw media frame access. Built on a native C++ addon (rtc-cpp/WebRTC), it lets you push and receive decoded video and audio frames from Node.js on realtime.

## Installation

```bash
# GITHUB_TOKEN with read access to releases is required while the repository is private
GITHUB_TOKEN=xxx npm install git+https://code.hq.twilio.com/client/twilio-video-node.git
```

A prebuilt native binary is downloaded automatically during `npm install`. No compilation required.

**Requirements:**
 * Node.js >= 24
 * macOS x64 or Linux x64

> **Apple Silicon:** The native binary is x64-only. Install Rosetta (`softwareupdate --install-rosetta`) and run Node under x64: `arch -x86_64 node ...`

## Quick Start

```js
const { connect, createLocalVideoTrack } = require('twilio-video-sdk');

const videoTrack = createLocalVideoTrack('my-camera');

const room = await connect(token, {
  name: 'my-room',
  videoTracks: [videoTrack],
});

console.log('Connected:', room.name, room.sid);

// Push I420 video frames
videoTrack.pushFrame(yPlane, uPlane, vPlane, 1280, 720);

// Receive remote video frames
room.on('participantConnected', (participant) => {
  participant.on('trackSubscribed', (track) => {
    if (track.onFrame) {
      track.onFrame((yBuf, uBuf, vBuf, metadata) => {
        console.log(`${metadata.width}x${metadata.height}`);
      });
    }
  });
});

// Clean up
room.disconnect();
```

## API Overview

### Top-level Functions

| Function | Description |
|---|---|
| `connect(token, options?)` | Connect to a room. Returns `Promise<Room>`. |
| `createLocalVideoTrack(name?)` | Create a pushable local video track. |
| `createLocalAudioTrack(name?)` | Create a pushable local audio track. |
| `setLogLevel(level)` | Set native log level (`'off'` \| `'fatal'` \| `'error'` \| `'warning'` \| `'info'` \| `'debug'` \| `'trace'` \| `'all'`). |
| `getVersion()` | Returns the native SDK version string. |

### Key Classes

| Export | Description |
|---|---|
| `Room` | A connected video room. Emits events, exposes participants. |
| `LocalParticipant` | The local participant. Publish/unpublish tracks. |
| `RemoteParticipant` | A remote participant. Emits `trackSubscribed`/`trackUnsubscribed`. |
| `LocalVideoTrack` | Pushable video track (`pushFrame`). |
| `LocalAudioTrack` | Pushable audio track (`pushSamples`). |
| `LocalDataTrack` | Send arbitrary data (`send`). |
| `RemoteVideoTrack` | Receive video frames (`onFrame`). |
| `RemoteAudioTrack` | Receive audio samples (`onData`). |
| `RemoteDataTrack` | Receive data messages (`onMessage`). |
| `MediaFactory` | Factory for creating local tracks with shared platform info. |

## Room Events

| Event | Handler Signature |
|---|---|
| `connected` | `() => void` |
| `disconnected` | `(error?: TwilioError) => void` |
| `connectFailure` | `(error: TwilioError) => void` |
| `reconnecting` | `(error: TwilioError) => void` |
| `reconnected` | `() => void` |
| `participantConnected` | `(participant: RemoteParticipant) => void` |
| `participantDisconnected` | `(participant: RemoteParticipant) => void` |
| `recordingStarted` | `() => void` |
| `recordingStopped` | `() => void` |
| `dominantSpeakerChanged` | `(participant: RemoteParticipant \| null) => void` |

### RemoteParticipant Events

| Event | Handler Signature |
|---|---|
| `trackSubscribed` | `(track: RemoteVideoTrack \| RemoteAudioTrack \| RemoteDataTrack) => void` |
| `trackUnsubscribed` | `(track: RemoteVideoTrack \| RemoteAudioTrack \| RemoteDataTrack) => void` |

## Track Types

### LocalVideoTrack

Push raw I420 video frames into a room.

```js
const track = createLocalVideoTrack('camera');
track.pushFrame(yPlane, uPlane, vPlane, width, height, timestampUs?);
track.enabled = false; // mute
```

### LocalAudioTrack

Push raw PCM audio samples into a room.

```js
const track = createLocalAudioTrack('mic');
track.pushSamples(samples, sampleRate, channels);
```

### LocalDataTrack

Send arbitrary string or binary messages.

```js
const factory = new MediaFactory();
const track = factory.createDataTrack({ name: 'chat', ordered: true });
room.localParticipant.publishTrack(track);
track.send('hello');
track.send(Buffer.from([0x01, 0x02]));
```

### RemoteVideoTrack

Receive decoded I420 video frames from a remote participant.

```js
track.onFrame((yBuf, uBuf, vBuf, metadata) => {
  // metadata: { width, height, strideY, strideU, strideV, timestampUs, rotation }
});
track.removeFrameCallback();
```

### RemoteAudioTrack

Receive decoded PCM audio samples from a remote participant.

```js
track.onData((samples, metadata) => {
  // metadata: { bitsPerSample, sampleRate, numberOfChannels, numberOfFrames, timestampUs }
});
track.removeDataCallback();
```

### RemoteDataTrack

Receive string or binary messages from a remote participant.

```js
track.onMessage((data) => { /* string | Buffer */ });
track.removeMessageCallback();
```

## Frame Formats

### Video (I420)

Frames are split into three separate `Buffer` planes:

| Plane | Size | Description |
|---|---|---|
| Y | `width * height` | Luminance |
| U | `width * height / 4` | Chrominance (Cb) |
| V | `width * height / 4` | Chrominance (Cr) |

`VideoFrameMetadata` includes `strideY`, `strideU`, `strideV` for padded rows, plus `timestampUs` and `rotation` (0, 90, 180, 270).

### Audio (PCM)

Audio is delivered as a single `Buffer` of interleaved 16-bit signed little-endian PCM samples.

`AudioFrameMetadata` includes `bitsPerSample`, `sampleRate`, `numberOfChannels`, `numberOfFrames`, and `timestampUs`.

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
  enableNetworkQuality?: boolean;
  region?: string;                      // e.g. 'us1', 'au1'
  platformInfo?: PlatformInfo;
  iceOptions?: IceOptions;
}
```

### IceOptions

```ts
{
  transportPolicy?: 'all' | 'relay';  // 'relay' forces TURN
  iceServers?: IceServer[];
}
```

### PlatformInfo

```ts
{
  sdkVersion?: string;
  platformName?: string;
  platformVersion?: string;
  deviceArchitecture?: string;
  deviceManufacturer?: string;
  deviceModel?: string;
}
```

## Platform Support

- **macOS** x64 (Apple Silicon via Rosetta)
- **Linux** x64
- **Node.js** >= 24.0.0

## Contributing

### Building from Source

```bash
# Prerequisites: cmake, C++17 compiler, rtc-cpp built at ../rtc-cpp/
TWILIO_VIDEO_NODE_SKIP_DOWNLOAD=1 npm install
npm run build           # Release
npm run build:debug     # Debug with symbols
npm run rebuild         # Clean + build
```

## Environment Variables

| Variable | Description |
|---|---|
| `GITHUB_TOKEN` | Auth token for downloading prebuilt binaries from private GitHub releases. |
| `TWILIO_VIDEO_NODE_SKIP_DOWNLOAD` | Set to `1` to skip prebuilt binary download during `npm install`. |
| `TWILIO_ACCESS_TOKEN` | Twilio access token, used by the examples. |

## Examples

See the [`examples/`](examples/) directory:

| Example | Description |
|---|---|
| [`virtual_camera.js`](examples/virtual_camera.js) | Decodes an MP4 with ffmpeg and pushes I420 frames to a room. |
| [`video_mirror.js`](examples/video_mirror.js) | Receives remote video frames and pushes them back as-is. |
| [`audio_push.js`](examples/audio_push.js) | Generates a sine wave tone and pushes PCM audio to a room. |

```bash
TWILIO_ACCESS_TOKEN=xxx node examples/virtual_camera.js [room-name]
```

## Testing

```bash
npm test                # Run all tests
npm run test:unit       # Unit tests only
npm run test:integration # Integration tests (requires TWILIO_ACCESS_TOKEN)
```

## License

See [LICENSE.md](https://code.hq.twilio.com/client/twilio-video-node/blob/master/LICENSE.md).
