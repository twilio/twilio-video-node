import { describe, it, expect, onTestFinished } from 'vitest';
import { connectToRoom, describeLiveRooms } from '../helpers/connect.js';
import { createGroupRoom } from '../helpers/rooms.js';
import { joinFromBrowser } from '../helpers/browser.js';
import type { RemoteTrack, RemoteVideoTrack, VideoFrame } from '../../lib/index.js';

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
});
