import { describe, it, expect, beforeAll, onTestFinished } from 'vitest';
import { connectToRoom, describeLiveRooms, watchTrackKind } from '../helpers/connect.js';
import { createGroupRoom } from '../helpers/rooms.js';
import { joinFromBrowser } from '../helpers/browser.js';
import type { RemoteTrack, RemoteVideoTrack, VideoFrame } from '../../lib/index.js';
import { isH264Enabled, MediaNoSupportedCodecError } from '../../lib/index.js';

const SUBSCRIBE_TIMEOUT = 15_000;
const MEDIA_FLOW_TIMEOUT = 10_000;

function withTimeout<T>(promise: Promise<T>, ms: number, what: () => string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timeout waiting for ${what()}`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

describe('Google Chrome participant', () => {
  beforeAll(() => {
    // test/h264/integration.test.ts covers Chrome's H.264 with enableH264(),
    // where the 53404 outcomes below don't hold.
    expect(isH264Enabled()).toBe(false);
  });

  it('Node receives I420 frames from Chrome in a VP8-only room', async () => {
    const room = await createGroupRoom({ videoCodecs: ['VP8'] });
    onTestFinished(room.complete);
    const node = await connectToRoom('node', room.name);
    onTestFinished(node.cleanup);

    // Attached before the browser joins, so the subscription can't be missed.
    const subscribed = new Promise<RemoteVideoTrack>(resolve => {
      const onSubscribed = (track: RemoteTrack) => {
        if (track.kind !== 'video') return;
        node.room.removeListener('trackSubscribed', onSubscribed);
        resolve(track as RemoteVideoTrack);
      };
      node.room.on('trackSubscribed', onSubscribed);
    });

    await joinFromBrowser(room.name, { identity: 'chrome', videoCodec: 'VP8' });
    const track = await withTimeout(
      subscribed,
      SUBSCRIBE_TIMEOUT,
      () => `the browser's video track\n${describeLiveRooms()}`,
    );

    const frames: VideoFrame[] = [];
    const iterator = track.frames({ mode: 'queue', maxQueue: 8 });
    try {
      await withTimeout(
        (async () => {
          for await (const frame of iterator) {
            frames.push(frame);
            if (frames.length >= 3) break;
          }
        })(),
        MEDIA_FLOW_TIMEOUT,
        () => `3 frames, got ${frames.length}`,
      );
    } finally {
      await iterator.return?.();
    }

    expect(frames[0].format).toBe('I420');
    expect(frames[0].width).toBeGreaterThan(0);
    expect(frames[0].height).toBeGreaterThan(0);
    // Above the sum of this test's own timeouts, so those fire first.
  }, 90_000);

  // Both codecs are allowed, so the browser's choice decides.
  it.each(['VP8', 'H264'] as const)('Chrome sends the chosen codec, %s', async videoCodec => {
    const room = await createGroupRoom({ videoCodecs: ['VP8', 'H264'] });
    onTestFinished(room.complete);
    await expect(
      joinFromBrowser(room.name, { identity: 'chrome', videoCodec }),
    ).resolves.toBeUndefined();
  });

  it('Node fails to subscribe to Chrome H.264 in an H.264-only room with 53404', async () => {
    const room = await createGroupRoom({ videoCodecs: ['H264'] });
    onTestFinished(room.complete);
    const node = await connectToRoom('node', room.name);
    onTestFinished(node.cleanup);
    const video = watchTrackKind(node.room, 'video');

    await joinFromBrowser(room.name, { identity: 'chrome', videoCodec: 'H264' });
    const [error] = await withTimeout(
      video.failed,
      SUBSCRIBE_TIMEOUT,
      () => `'trackSubscriptionFailed' for video\n${describeLiveRooms()}`,
    );

    expect(error).toBeInstanceOf(MediaNoSupportedCodecError);
    expect(error.code).toBe(53404);
  }, 90_000);

  it("a 53404 on Chrome's H.264 video doesn't block its audio in a VP8 and H.264 room", async () => {
    const room = await createGroupRoom({ videoCodecs: ['VP8', 'H264'] });
    onTestFinished(room.complete);
    const node = await connectToRoom('node', room.name);
    onTestFinished(node.cleanup);
    const video = watchTrackKind(node.room, 'video');
    const audio = watchTrackKind(node.room, 'audio');

    await joinFromBrowser(room.name, { identity: 'chrome', videoCodec: 'H264', audio: true });
    const [error] = await withTimeout(
      video.failed,
      SUBSCRIBE_TIMEOUT,
      () => `'trackSubscriptionFailed' for video\n${describeLiveRooms()}`,
    );
    await withTimeout(
      audio.subscribed,
      SUBSCRIBE_TIMEOUT,
      () => `the browser's audio track\n${describeLiveRooms()}`,
    );

    expect(error).toBeInstanceOf(MediaNoSupportedCodecError);
    expect(error.code).toBe(53404);
  }, 90_000);
});
