/**
 * H.264 media through a real OpenH264 library. Loading OpenH264 changes the
 * codecs of every media factory created afterwards in the process, so these
 * tests live apart from test/integration.test.ts and test/browser/, which
 * cover the SDK without it. They also need Google Chrome, as test:browser
 * does. Skipped unless OPENH264_PATH names an OpenH264 2.7 library, for
 * example Cisco's binary for this platform:
 *
 *   OPENH264_PATH=/path/to/libopenh264-2.7.0-linux64.8.so npm run test:h264
 */
import { describe, it, expect, beforeAll, onTestFinished } from 'vitest';
import { connectToRoom, describeLiveRooms, watchTrackKind } from '../helpers/connect.js';
import { createGroupRoom } from '../helpers/rooms.js';
import { joinFromBrowser } from '../helpers/browser.js';
import type {
  I420Plane,
  RemoteParticipant,
  RemoteTrack,
  RemoteVideoTrack,
  Room,
  StatsReport,
  VideoFrame,
  VideoFrameInput,
} from '../../lib/index.js';
import { createLocalVideoTrack, enableH264, isH264Enabled } from '../../lib/index.js';

const OPENH264_PATH = process.env.OPENH264_PATH;
const SUBSCRIBE_TIMEOUT = 15_000;
const MEDIA_TIMEOUT = 10_000;
const WIDTH = 640;
const HEIGHT = 480;
// Frames to skip before checking content, while the encoder ramps up from its start bitrate.
const WARMUP_FRAMES = 30;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function waitForSubscribed(participant: RemoteParticipant): Promise<RemoteVideoTrack> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Timeout waiting for 'trackSubscribed'")),
      SUBSCRIBE_TIMEOUT,
    );
    // Alice publishes only video.
    participant.once('trackSubscribed', track => {
      clearTimeout(timer);
      resolve(track as RemoteVideoTrack);
    });
  });
}

// Alice publishes, Bob subscribes. Returns Bob's view of Alice.
async function connectPair(roomName: string) {
  const alice = await connectToRoom('alice', roomName);
  onTestFinished(alice.cleanup);
  const bob = await connectToRoom('bob', roomName);
  onTestFinished(bob.cleanup);
  for (const deadline = Date.now() + SUBSCRIBE_TIMEOUT; Date.now() < deadline;) {
    const remoteAlice = [...bob.room.participants.values()].find(p => p.identity === 'alice');
    if (remoteAlice) return { alice: alice.room, bob: bob.room, remoteAlice };
    await sleep(100);
  }
  throw new Error('Bob never saw Alice join');
}

// Video codecs from `room`'s stats, polled because they stay empty until media
// has flowed.
async function videoCodecs(
  room: Room,
  pick: (report: StatsReport) => { codec: string }[],
): Promise<string[]> {
  for (const deadline = Date.now() + MEDIA_TIMEOUT; Date.now() < deadline;) {
    const codecs = (await room.getStats())
      .flatMap(pick)
      .map(s => s.codec)
      .filter(Boolean);
    if (codecs.length > 0) return codecs;
    await sleep(250);
  }
  return [];
}

function fillPlane(
  width: number,
  height: number,
  value: (x: number, y: number) => number,
): I420Plane {
  const data = Buffer.alloc(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data[y * width + x] = value(x, y);
  }
  return { data, stride: width, width, height };
}

// Each plane splits differently (Y left/right, U top/bottom, V right/left), so
// swapped planes or a wrong stride on the decoded copy move the sampled values.
function patternFrame(): VideoFrameInput {
  const cw = WIDTH / 2;
  const ch = HEIGHT / 2;
  return {
    format: 'I420',
    width: WIDTH,
    height: HEIGHT,
    y: fillPlane(WIDTH, HEIGHT, x => (x < WIDTH / 2 ? 50 : 200)),
    u: fillPlane(cw, ch, (_x, y) => (y < ch / 2 ? 64 : 192)),
    v: fillPlane(cw, ch, x => (x < cw / 2 ? 192 : 64)),
  };
}

// The value at a position given as fractions of the plane's size, since WebRTC
// may scale the stream down while its bitrate ramps up.
function sample(plane: I420Plane, fx: number, fy: number): number {
  return plane.data[Math.floor(fy * plane.height) * plane.stride + Math.floor(fx * plane.width)];
}

// Publishes a patterned video track from Alice and resolves with a frame Bob
// decoded after the warm-up. Frames keep flowing until the test finishes.
async function publishVideo(alice: Room, remoteAlice: RemoteParticipant): Promise<VideoFrame> {
  const track = createLocalVideoTrack('cam');
  const subscribed = waitForSubscribed(remoteAlice);
  alice.localParticipant.publishTrack(track);
  const remoteTrack = await subscribed;

  const frame = patternFrame();
  const writer = setInterval(() => track.write(frame), 33);
  onTestFinished(() => clearInterval(writer));
  return frameAfterWarmup(remoteTrack);
}

// Resolves with the first frame `remoteTrack` delivers after the warm-up.
// Frames keep being read until the test finishes.
async function frameAfterWarmup(remoteTrack: RemoteVideoTrack): Promise<VideoFrame> {
  const frames = remoteTrack.frames({ mode: 'queue', maxQueue: 8 });
  onTestFinished(async () => {
    await frames.return?.();
  });

  const received = (async () => {
    for (let i = 0; ; i++) {
      const next = await frames.next();
      if (next.done) throw new Error(`Frames ended after ${i}`);
      if (i >= WARMUP_FRAMES) return next.value;
    }
  })();
  const timeout = sleep(MEDIA_TIMEOUT).then(() => {
    throw new Error(`Fewer than ${WARMUP_FRAMES + 1} video frames reached the subscriber`);
  });
  return Promise.race([received, timeout]);
}

// The watched track, or the subscription error if Node fails to subscribe, so
// a 53404 fails the test with that error instead of a timeout.
function subscribed(watch: ReturnType<typeof watchTrackKind>, what: string): Promise<RemoteTrack> {
  return Promise.race([
    watch.subscribed,
    watch.failed.then(([error]) => {
      throw error;
    }),
    sleep(SUBSCRIBE_TIMEOUT).then(() => {
      throw new Error(`Timeout waiting for ${what}\n${describeLiveRooms()}`);
    }),
  ]);
}

describe.skipIf(!OPENH264_PATH)('H.264 through OpenH264', () => {
  beforeAll(() => {
    // Before any connect(): the media factory picks up the library when it is created.
    enableH264({ openh264Path: OPENH264_PATH!, confirmPatentLicensingCompliance: true });
    expect(isH264Enabled()).toBe(true);
  });

  it('sends and receives H.264 video in an H.264-only room', async () => {
    const room = await createGroupRoom({ videoCodecs: ['H264'] });
    onTestFinished(room.complete);
    const { alice, bob, remoteAlice } = await connectPair(room.name);

    const frame = await publishVideo(alice, remoteAlice);

    expect(await videoCodecs(alice, r => r.localVideoTrackStats)).toEqual(['H264']);
    expect(await videoCodecs(bob, r => r.remoteVideoTrackStats)).toEqual(['H264']);
    expect(frame.width / frame.height).toBeCloseTo(WIDTH / HEIGHT, 2);
    // Sampled away from the pattern's edges, where H.264 keeps flat areas close to the source.
    const samples = {
      yLeft: sample(frame.y, 0.25, 0.5),
      yRight: sample(frame.y, 0.75, 0.5),
      uTop: sample(frame.u, 0.5, 0.375),
      uBottom: sample(frame.u, 0.5, 0.85),
      vLeft: sample(frame.v, 0.125, 0.5),
      vRight: sample(frame.v, 0.875, 0.5),
    };
    const expected = { yLeft: 50, yRight: 200, uTop: 64, uBottom: 192, vLeft: 192, vRight: 64 };
    for (const [key, value] of Object.entries(samples)) {
      expect(value, key).toBeGreaterThan(expected[key as keyof typeof expected] - 16);
      expect(value, key).toBeLessThan(expected[key as keyof typeof expected] + 16);
    }
  });

  it('still publishes VP8 in a room that allows VP8 and H.264', async () => {
    const room = await createGroupRoom({ videoCodecs: ['VP8', 'H264'] });
    onTestFinished(room.complete);
    const { alice, remoteAlice } = await connectPair(room.name);

    await publishVideo(alice, remoteAlice);

    expect(await videoCodecs(alice, r => r.localVideoTrackStats)).toEqual(['VP8']);
  });

  it('publishes connect-time video on H.264 in an H.264-only room when VP8 is preferred', async () => {
    const room = await createGroupRoom({ videoCodecs: ['H264'] });
    onTestFinished(room.complete);
    const bob = await connectToRoom('bob', room.name);
    onTestFinished(bob.cleanup);
    const video = watchTrackKind(bob.room, 'video');

    const cam = createLocalVideoTrack('cam');
    const alice = await connectToRoom('alice', room.name, {
      videoTracks: [cam],
      preferredVideoCodecs: ['VP8', 'H264'],
    });
    onTestFinished(alice.cleanup);
    const frame = patternFrame();
    const writer = setInterval(() => cam.write(frame), 33);
    onTestFinished(() => clearInterval(writer));
    const remoteTrack = (await subscribed(video, "alice's video")) as RemoteVideoTrack;

    // The OpenH264 encoder fails to initialize with more than one simulcast
    // stream, so H.264 frames arriving means the track is sent without simulcast.
    await frameAfterWarmup(remoteTrack);
    expect(await videoCodecs(alice.room, r => r.localVideoTrackStats)).toEqual(['H264']);
  });

  it('decodes Chrome H.264 to I420 frames in an H.264-only room', async () => {
    const room = await createGroupRoom({ videoCodecs: ['H264'] });
    onTestFinished(room.complete);
    const node = await connectToRoom('node', room.name);
    onTestFinished(node.cleanup);
    const video = watchTrackKind(node.room, 'video');

    await joinFromBrowser(room.name, { identity: 'chrome', videoCodec: 'H264' });
    const remoteTrack = (await subscribed(video, "Chrome's video")) as RemoteVideoTrack;
    const frame = await frameAfterWarmup(remoteTrack);

    expect(frame.format).toBe('I420');
    expect(frame.width).toBeGreaterThan(0);
    expect(frame.height).toBeGreaterThan(0);
    expect(await videoCodecs(node.room, r => r.remoteVideoTrackStats)).toEqual(['H264']);
  }, 90_000);

  it("decodes Chrome H.264 in a VP8 and H.264 room, where Chrome's audio subscribes too", async () => {
    const room = await createGroupRoom({ videoCodecs: ['VP8', 'H264'] });
    onTestFinished(room.complete);
    const node = await connectToRoom('node', room.name);
    onTestFinished(node.cleanup);
    const video = watchTrackKind(node.room, 'video');
    const audio = watchTrackKind(node.room, 'audio');

    await joinFromBrowser(room.name, { identity: 'chrome', videoCodec: 'H264', audio: true });
    const remoteTrack = (await subscribed(video, "Chrome's video")) as RemoteVideoTrack;
    await subscribed(audio, "Chrome's audio");
    const frame = await frameAfterWarmup(remoteTrack);

    expect(frame.format).toBe('I420');
    expect(await videoCodecs(node.room, r => r.remoteVideoTrackStats)).toEqual(['H264']);
  }, 90_000);
});
