# @twilio/video-node-sdk

[![CI](https://github.com/twilio/twilio-video-node/actions/workflows/ci.yml/badge.svg?branch=main&event=push)](https://github.com/twilio/twilio-video-node/actions/workflows/ci.yml)

Server-side Node.js SDK for Twilio Video Group Rooms with raw media frame access. Built on a native C++ addon over WebRTC, it lets a Node.js process push and receive decoded video and audio frames in real time.

**Note: this is a beta release of the Twilio Media SDK for Node.js. It is provided for evaluation purposes only. During the beta period this SDK is not HIPAA eligible.**

- [Overview](https://www.twilio.com/docs/video/node)
- [Quickstart](https://www.twilio.com/docs/video/node-getting-started)
- [Work with media frames](https://www.twilio.com/docs/video/node-working-with-media-frames)
- [Best practices](https://www.twilio.com/docs/video/node-best-practices)
- [Differences from the JavaScript SDK](https://www.twilio.com/docs/video/node-differences-from-javascript-sdk)
- [Troubleshooting](https://www.twilio.com/docs/video/media-sdk-troubleshooting)
- [API reference](https://twilio.github.io/twilio-video-node/latest/)
- [Changelog](CHANGELOG.md)

## Requirements

The native binary is prebuilt and bundled, so there is no build step.

- Node.js >= 24.0.0
- Linux x86-64 with glibc: Ubuntu 22.04+ or Debian 12+
- macOS 26+ on x86-64, for local development only. The macOS build is not supported in production.

The binary is x86-64 only. On Apple Silicon, Node must run under Rosetta so that `process.arch` reports `x64`; under a native arm64 Node, `npm install` fails with `EBADPLATFORM`. Alpine and other musl-based distros, native arm64 and Windows are not supported.

On Linux the addon is linked against glibc and requires:

| Requirement           | Minimum |
| --------------------- | ------- |
| glibc                 | 2.34    |
| libstdc++ (`GLIBCXX`) | 3.4.30  |
| C++ ABI (`CXXABI`)    | 1.3.11  |

It also links `libX11.so.6`, which WebRTC requires unconditionally. Install your distro's X11 client library (`libx11-6` on Debian and Ubuntu) even on headless servers.

On macOS, npm cannot check the OS version, so on a release older than macOS 26 `npm install` succeeds and the SDK fails when it loads the addon.

The addon is built with N-API, so it does not need rebuilding for each Node.js release.

## Installation

```bash
npm install @twilio/video-node-sdk
```

`connect()` takes a standard Twilio Video Access Token with a VideoGrant, the same token format the JavaScript SDK uses. Generate one with the [`twilio`](https://www.npmjs.com/package/twilio) helper library; see [User Identity and Access Tokens](https://www.twilio.com/docs/video/tutorials/user-identity-access-tokens).

## Quick start

```js
const { connect, createLocalVideoTrack } = require('@twilio/video-node-sdk');

async function main() {
  const videoTrack = createLocalVideoTrack('virtual-camera');

  const room = await connect(token, {
    name: 'my-room',
    videoTracks: [videoTrack],
  });

  console.log('Connected to Room:', room.name, room.sid);

  // Push I420 video frames. Frames written before connect() resolves are dropped.
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
    try {
      // Frames that arrive while you process one are queued, and the SDK drops
      // them if the queue fills. The loop ends by itself when the track is
      // unsubscribed or the Room disconnects.
      for await (const frame of track.frames()) {
        console.log(`${frame.width}x${frame.height} @ ${frame.timestamp}us`);
        frame.close?.();
      }
    } catch (err) {
      // Nothing awaits this function, so an error that escapes here becomes an
      // unhandled rejection and stops the process.
      console.error('Frame loop failed:', err);
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
  // track can finish subscribing before the trackSubscribed listener is attached.
  // Seed from room.participants and check isSubscribed on each publication.
  room.participants.forEach(participantConnected);
  room.on('participantConnected', participantConnected);

  room.on('disconnected', () => {
    room.dispose();
  });
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
```

Call `room.dispose()` when you are done with a Room. Until you do, the Node.js process does not exit; `disconnect()` leaves the Room but does not release its native resources. See [LIFECYCLE.md](LIFECYCLE.md).

## Further reading

- [FRAME_CONTRACT.md](FRAME_CONTRACT.md): buffer ownership, backpressure and drop semantics, timestamps, and publish invariants.
- [LIFECYCLE.md](LIFECYCLE.md): what each object owns, what `disconnect()` and `dispose()` release, and event ordering during teardown.
- [SECURITY-PRIVACY.md](SECURITY-PRIVACY.md): what the SDK does with decoded media, and which obligations remain with the application.

## Examples

The [`examples/`](examples/README.md) directory has runnable examples, with setup steps: a virtual camera, a video mirror, audio push, data tracks, a voice agent, and two computer-vision examples.

## Feedback

To report a bug or request a feature, see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

See [LICENSE.md](LICENSE.md).
