import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { onTestFinished } from 'vitest';
import { chromium } from 'playwright-core';
import { generateToken } from './token.js';

type BrowserVideoCodec = 'VP8' | 'H264';

const require = createRequire(import.meta.url);
const TWILIO_VIDEO_JS = path.join(
  path.dirname(require.resolve('twilio-video/package.json')),
  'dist',
  'twilio-video.min.js',
);

// Served by page.route. 127.0.0.1 is a secure context, so getUserMedia works.
const ORIGIN = 'http://127.0.0.1';

const JOIN_TIMEOUT = 20_000;

// Page globals, typed here because tsconfig.test.json has no DOM lib.
interface PageParticipant {
  videoTracks: Map<string, unknown>;
  once(event: string, listener: (...args: unknown[]) => void): void;
}
interface PageRoom {
  localParticipant: PageParticipant;
  getStats(): Promise<{ localVideoTrackStats: { codec: string | null }[] }[]>;
  disconnect(): void;
}
interface PageGlobals {
  Twilio: { Video: { connect(token: string, options: object): Promise<PageRoom> } };
  room?: PageRoom;
}

/**
 * Join `roomName` from headless Google Chrome and publish a fake camera with
 * `videoCodec`. Resolves once Chrome is sending that codec. Closes the browser
 * through `onTestFinished`; the caller owns the Room.
 */
async function joinFromBrowser(
  roomName: string,
  { identity, videoCodec }: { identity: string; videoCodec: BrowserVideoCodec },
): Promise<void> {
  const launched = chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
  // Registered first, so a failed launch or join is still cleaned up.
  onTestFinished(async () => {
    const browser = await launched.catch(() => undefined);
    if (!browser) return;
    const [page] = browser.contexts().flatMap(c => c.pages());
    await page
      ?.evaluate(() => (globalThis as unknown as PageGlobals).room?.disconnect())
      .catch(() => {});
    await browser.close();
  });

  const browser = await launched;
  const page = await browser.newPage();
  await page.route(`${ORIGIN}/**`, route => {
    if (new URL(route.request().url()).pathname === '/twilio-video.min.js') {
      return route.fulfill({ contentType: 'text/javascript', body: readFileSync(TWILIO_VIDEO_JS) });
    }
    return route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><script src="/twilio-video.min.js"></script>',
    });
  });
  await page.goto(`${ORIGIN}/`);

  const join = page.evaluate(
    async ({ token, roomName, videoCodec }) => {
      const g = globalThis as unknown as PageGlobals;
      g.room = await g.Twilio.Video.connect(token, {
        name: roomName,
        audio: false,
        video: true,
        preferredVideoCodecs: [videoCodec],
      });
      const local = g.room.localParticipant;
      if (local.videoTracks.size === 0) {
        await new Promise<void>((resolve, reject) => {
          local.once('trackPublished', () => resolve());
          local.once('trackPublicationFailed', error => reject(error));
        });
      }
      // preferredVideoCodecs is only a preference, so check what is sent.
      for (;;) {
        const reports = await g.room.getStats();
        const codecs = reports.flatMap(r => r.localVideoTrackStats.map(s => s.codec));
        const codec = codecs.find(c => c);
        if (codec) {
          if (codec !== videoCodec) throw new Error(`Chrome sent ${codec}, not ${videoCodec}`);
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    },
    { token: generateToken(identity, roomName), roomName, videoCodec },
  );
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      join,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Timeout waiting for ${identity} to publish from Chrome`)),
          JOIN_TIMEOUT,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export { joinFromBrowser };
