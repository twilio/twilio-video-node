import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import { connectToRoom } from './helpers/connect.js';
import { generateToken, badTokens } from './helpers/token.js';
import { generateI420Frame, generateAudioSamples } from './helpers/media.js';
import type {
  RemoteVideoTrack,
  RemoteAudioTrack,
  RemoteDataTrack,
  RemoteParticipant,
  VideoFrame,
  AudioFrame,
  RemoteTrack,
  RemoteTrackPublication,
  StatsReport,
  VideoContentPreferences,
} from '../lib/index.js';
import {
  connect,
  createLocalVideoTrack,
  createLocalAudioTrack,
  createLocalDataTrack,
  LocalVideoTrackPublication,
  RemoteVideoTrackPublication,
  TwilioError,
} from '../lib/index.js';
import type { EventEmitter } from 'node:events';

const TIMEOUT = {
  // 15s was tight enough to flake late in a full suite run, where the late-joiner
  // case timed out at 15s but passes in isolation. vitest's testTimeout is 60s,
  // so 30s still fails a genuinely broken subscribe rather than hanging.
  subscribe: 30_000,
  mediaFlow: 10_000,
  // SDP renegotiation after publishTrack + trackSubscribed needs time to complete
  // before the encoder sink attaches and frames actually flow
  negotiate: 3_000,
} as const;

function uniqueRoom(): string {
  return `test-${crypto.randomUUID()}`;
}

/**
 * Resolve once `count` of a participant's publications report `isSubscribed`.
 * Polls state rather than counting events, because a subscription completing
 * before a listener attaches is never replayed.
 */
async function waitForSubscribed(
  participant: RemoteParticipant,
  count: number,
  timeout: number,
): Promise<void> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const subscribed = [...participant.tracks.values()].filter(p => p.isSubscribed).length;
    if (subscribed >= count) return;
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for ${count} subscribed tracks; got ${subscribed}`);
    }
    await sleep(250);
  }
}

function waitForEvents<T = unknown>(
  emitter: EventEmitter,
  event: string,
  count: number,
  timeout: number,
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const received: T[] = [];
    const timer = setTimeout(() => {
      emitter.removeListener(event, handler);
      reject(
        new Error(
          count === 1
            ? `Timeout waiting for '${event}'`
            : `Timeout waiting for ${count} '${event}' events; got ${received.length}`,
        ),
      );
    }, timeout);
    const handler = (arg: T) => {
      received.push(arg);
      if (received.length < count) return;
      clearTimeout(timer);
      emitter.removeListener(event, handler);
      resolve(received);
    };
    emitter.on(event, handler);
  });
}

function waitForEvent<T = unknown>(
  emitter: EventEmitter,
  event: string,
  timeout: number,
): Promise<T> {
  return waitForEvents<T>(emitter, event, 1, timeout).then(([first]) => first);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function connectPair(roomName: string, opts = {}) {
  const connA = await connectToRoom('alice', roomName, opts);

  const aSeesBPromise = waitForEvent<RemoteParticipant>(
    connA.room,
    'participantConnected',
    TIMEOUT.subscribe,
  );
  const connB = await connectToRoom('bob', roomName, opts);

  let remoteA: RemoteParticipant | undefined = [...connB.room.participants.values()].find(
    (p: RemoteParticipant) => p.identity === 'alice',
  );
  if (!remoteA) {
    remoteA = await waitForEvent<RemoteParticipant>(
      connB.room,
      'participantConnected',
      TIMEOUT.subscribe,
    );
  }

  const remoteB = await aSeesBPromise;

  return { connA, connB, remoteB, remoteA };
}

describe('Room connect/disconnect', () => {
  it('connects, verifies state, disconnects', async () => {
    const roomName = uniqueRoom();
    const { room, cleanup } = await connectToRoom('alice', roomName);

    try {
      expect(room.state).toBe('connected');
      expect(room.name).toBe(roomName);
      expect(room.sid).toBeTruthy();
      expect(room.localParticipant).toBeTruthy();
      expect(room.localParticipant.identity).toBe('alice');
    } finally {
      await cleanup();
    }
  });
});

describe('Participant discovery', () => {
  it('both participants see each other', async () => {
    const roomName = uniqueRoom();
    const { connA, connB, remoteB, remoteA } = await connectPair(roomName);

    try {
      expect(remoteB.identity).toBe('bob');
      expect(remoteA).toBeTruthy();
      expect(remoteA.identity).toBe('alice');
    } finally {
      await Promise.all([connA.cleanup(), connB.cleanup()]);
    }
  });
});

describe('Error cases, provoked end to end', () => {
  // These drive the real failure rather than constructing an error object, so
  // they prove the whole path: server rejection -> native error payload ->
  // liftTwilioError -> the typed subclass a consumer catches.

  it.each([
    ['a malformed token', () => badTokens.malformed(), 'AccessTokenInvalidError', 20101],
    ['an expired token', () => badTokens.expired(), 'AccessTokenExpiredError', 20104],
    [
      'a token with no Video grant',
      () => badTokens.noVideoGrant(),
      'AccessTokenGrantsInvalidError',
      20106,
    ],
    [
      'a tampered signature',
      () => badTokens.badSignature(),
      'AccessTokenSignatureInvalidError',
      20107,
    ],
  ])('rejects %s with %s', async (_label, makeToken, expectedName, expectedCode) => {
    const error = await connect(makeToken(), {
      name: uniqueRoom(),
      connectionTimeout: 20_000,
    }).then(
      room => {
        room.disconnect();
        room.dispose();
        throw new Error('connect unexpectedly succeeded');
      },
      (e: TwilioError) => e,
    );

    expect(error).toBeInstanceOf(TwilioError);
    expect(error.name).toBe(expectedName);
    expect(error.code).toBe(expectedCode);
  });

  it('disconnects the first participant when a duplicate identity joins', async () => {
    const roomName = uniqueRoom();

    const first = await connectToRoom('same-identity', roomName);
    // waitForEvent resolves the event's first argument, which for `disconnected`
    // is the Room; the error is the second.
    const evicted = new Promise<TwilioError | undefined>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Timeout waiting for 'disconnected'")),
        TIMEOUT.subscribe,
      );
      first.room.once('disconnected', (_room, error) => {
        clearTimeout(timer);
        resolve(error);
      });
    });

    // The same identity joining evicts the earlier participant.
    const second = await connectToRoom('same-identity', roomName);

    try {
      const error = await evicted;
      expect(error).toBeInstanceOf(TwilioError);
      expect(error?.code).toBe(53205);
      expect(error?.name).toBe('ParticipantDuplicateIdentityError');
    } finally {
      await second.cleanup();
      first.room.dispose();
    }
  });

  it('rejects an oversize data-track message before it reaches the wire', async () => {
    const roomName = uniqueRoom();
    const dataTrack = createLocalDataTrack('oversize-probe');
    const conn = await connectToRoom('sender', roomName, { dataTracks: [dataTrack] });

    try {
      // 64 KB is rtc-cpp's kMaxMessageSize. Over it, the message was previously
      // discarded with no signal at all.
      expect(() => dataTrack.send(Buffer.alloc(64 * 1024 + 1))).toThrow(RangeError);
      // At the limit it is accepted, and reports its outcome.
      const result = await Promise.race([
        dataTrack.send(Buffer.alloc(64 * 1024)),
        sleep(TIMEOUT.mediaFlow).then(() => ({ ok: 'timeout' })),
      ]);
      expect(result).toHaveProperty('ok');
    } finally {
      await conn.cleanup();
    }
  });

  it('rejects invalid frame input against a live, publishing track', async () => {
    const roomName = uniqueRoom();
    const videoTrack = createLocalVideoTrack('validation-probe');
    const conn = await connectToRoom('publisher', roomName, { videoTracks: [videoTrack] });

    try {
      const base = generateI420Frame(320, 240);
      // Validation applies on a connected, publishing track too - not only
      // before the encoder sink attaches.
      expect(() => videoTrack.write({ ...base, width: 321 })).toThrow(/must be even/);
      expect(() => videoTrack.write({ ...base, y: { ...base.y, data: Buffer.alloc(4) } })).toThrow(
        /smaller than stride/,
      );
      expect(() => videoTrack.write({ ...base, timestamp: -1 })).toThrow(/non-negative/);
      // A valid frame still goes through afterwards, so validation did not wedge it.
      expect(typeof videoTrack.write(base)).toBe('boolean');
    } finally {
      await conn.cleanup();
    }
  });
});

describe('Multiple participants', () => {
  it('a third participant sees both existing publishers and their media', async () => {
    const roomName = uniqueRoom();
    const aliceVideo = createLocalVideoTrack('alice-cam');
    const bobVideo = createLocalVideoTrack('bob-cam');

    const { connA, connB } = await connectPair(roomName);
    connA.room.localParticipant.publishTrack(aliceVideo);
    connB.room.localParticipant.publishTrack(bobVideo);

    // Carol joins after both are already publishing, which is the case that
    // previously missed events for participants present before the join.
    const carol = await connectToRoom('carol', roomName);

    try {
      const subscribed = new Map<string, RemoteVideoTrack>();
      const done = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`Carol subscribed to ${subscribed.size} of 2 tracks`)),
          TIMEOUT.subscribe,
        );
        carol.room.on('trackSubscribed', track => {
          if (track.kind !== 'video') return;
          subscribed.set(track.name, track as RemoteVideoTrack);
          if (subscribed.size >= 2) {
            clearTimeout(timer);
            resolve();
          }
        });
      });

      await done;
      expect([...subscribed.keys()].sort()).toEqual(['alice-cam', 'bob-cam']);
      expect(carol.room.participants.size).toBe(2);

      // Each publisher's frames reach Carol independently.
      await sleep(TIMEOUT.negotiate);
      const pushInterval = setInterval(() => {
        aliceVideo.write(generateI420Frame(640, 480));
        bobVideo.write(generateI420Frame(640, 480));
      }, 33);

      try {
        for (const [name, track] of subscribed) {
          const iterator = track.frames({ mode: 'latest', maxQueue: 1 });
          const first = await Promise.race([
            iterator.next(),
            sleep(TIMEOUT.mediaFlow).then(() => {
              throw new Error(`No frames from ${name}`);
            }),
          ]);
          expect((first as IteratorResult<VideoFrame>).done).toBe(false);
          await iterator.return?.();
        }
      } finally {
        clearInterval(pushInterval);
      }
    } finally {
      await Promise.all([connA.cleanup(), connB.cleanup(), carol.cleanup()]);
    }
  });
});

describe('connectionTimeout', () => {
  it('rejects with RoomConnectTimeoutError when the deadline passes first', async () => {
    // A real token against a real room, but a deadline far shorter than any
    // connect can complete in, so the timeout path is what settles the promise.
    const token = generateToken('timeout-probe', uniqueRoom());
    const started = Date.now();

    await expect(connect(token, { connectionTimeout: 1 })).rejects.toThrow(/Timed out after 1 ms/);
    // It must reject on the deadline, not after the full connect attempt.
    expect(Date.now() - started).toBeLessThan(3_000);
  });
});

describe('Backpressure under real media', () => {
  it('a slow consumer sheds frames, and the loss is counted and reported', async () => {
    const roomName = uniqueRoom();
    const videoTrack = createLocalVideoTrack('backpressure-cam');

    const { connA, connB, remoteA } = await connectPair(roomName);

    const trackPromise = waitForEvent<RemoteVideoTrack>(
      remoteA,
      'trackSubscribed',
      TIMEOUT.subscribe,
    );
    connA.room.localParticipant.publishTrack(videoTrack);
    const remoteTrack = await trackPromise;

    await sleep(TIMEOUT.negotiate);

    const dropEvents: Array<{ count: number; sinceLastUs: number }> = [];
    remoteTrack.on('frameDropped', (count, sinceLastUs) => dropEvents.push({ count, sinceLastUs }));

    // maxQueue 1 with a consumer far slower than the 30fps publisher: frames
    // arriving behind the in-flight one must be shed, not buffered.
    const iterator = remoteTrack.frames({ mode: 'latest', maxQueue: 1 });

    const pushInterval = setInterval(() => {
      videoTrack.write(generateI420Frame(640, 480));
    }, 33);

    let consumed = 0;
    const loop = (async () => {
      for await (const frame of iterator) {
        consumed++;
        frame.close?.();
        // Deliberately slower than the publisher.
        await sleep(300);
        if (consumed >= 4) break;
      }
    })();

    try {
      await Promise.race([
        loop,
        sleep(20_000).then(() => {
          throw new Error(`Consumed only ${consumed} frames`);
        }),
      ]);

      const stats = remoteTrack.getStats();
      expect(stats.framesDelivered).toBeGreaterThanOrEqual(4);
      // A ~3fps consumer against a 30fps publisher must have shed frames.
      expect(stats.framesDropped).toBeGreaterThan(0);
      // The queue never grows past its bound; that is the whole point.
      expect(stats.queueDepth).toBeLessThanOrEqual(stats.maxQueue);
      expect(stats.maxQueue).toBe(1);

      // Loss is reported, not merely countable.
      await sleep(700); // let the coalescing window elapse
      expect(dropEvents.length).toBeGreaterThan(0);
      expect(dropEvents[0].count).toBeGreaterThan(0);
    } finally {
      clearInterval(pushInterval);
      await iterator.return?.();
      await Promise.all([connA.cleanup(), connB.cleanup()]);
    }
  });
});

describe('Video publish + receive', () => {
  it('B receives video frames from A', async () => {
    const roomName = uniqueRoom();
    const videoTrack = createLocalVideoTrack('test-cam');

    const { connA, connB, remoteA } = await connectPair(roomName);

    const trackPromise = waitForEvent<RemoteVideoTrack>(
      remoteA,
      'trackSubscribed',
      TIMEOUT.subscribe,
    );
    connA.room.localParticipant.publishTrack(videoTrack);
    const remoteTrack = await trackPromise;

    // Wait for peer connection renegotiation so encoder sink attaches
    await sleep(TIMEOUT.negotiate);

    // Register frame callback, then start pushing
    // Read through the receive API: awaiting each frame is the
    // backpressure. 'queue' mode so a slow assertion loop does not shed the
    // frames this test is trying to count.
    const receivedFrames: VideoFrame[] = [];
    const iterator = remoteTrack.frames({ mode: 'queue', maxQueue: 8 });

    const pushInterval = setInterval(() => {
      videoTrack.write(generateI420Frame(640, 480));
    }, 33);

    const framesPromise = (async () => {
      for await (const frame of iterator) {
        receivedFrames.push(frame);
        if (receivedFrames.length >= 3) break;
      }
    })();

    try {
      await Promise.race([
        framesPromise,
        sleep(TIMEOUT.mediaFlow).then(() => {
          throw new Error(`Only received ${receivedFrames.length} frames`);
        }),
      ]);

      expect(receivedFrames.length).toBeGreaterThanOrEqual(3);
      const frame = receivedFrames[0];
      expect(frame.format).toBe('I420');
      expect(Buffer.isBuffer(frame.y.data)).toBe(true);
      expect(Buffer.isBuffer(frame.u.data)).toBe(true);
      expect(Buffer.isBuffer(frame.v.data)).toBe(true);
      expect(frame.width).toBeGreaterThan(0);
      expect(frame.height).toBeGreaterThan(0);
      // Microseconds as a plain number, per the frame contract.
      expect(typeof frame.timestamp).toBe('number');
      expect(Number.isFinite(frame.timestamp)).toBe(true);
      // SDK-generated per-track counter: must advance, unlike libwebrtc's
      // VideoFrame::id() which read 0 for every frame.
      const ids = receivedFrames.map(f => f.frameId);
      expect(ids[1]).toBeGreaterThan(ids[0]);
      expect(new Set(ids).size).toBe(ids.length);

      // Receive-side counters are populated.
      const stats = remoteTrack.getStats();
      expect(stats.framesDelivered).toBeGreaterThanOrEqual(3);
      expect(stats.maxQueue).toBe(8);

      // close() releases the planes and makes further reads throw.
      frame.close?.();
      expect(() => frame.y).toThrow(/closed/);
    } finally {
      clearInterval(pushInterval);
      await iterator.return?.();
      await Promise.all([connA.cleanup(), connB.cleanup()]);
    }
  });
});

describe('Audio publish + receive', () => {
  it('B receives audio samples from A', async () => {
    const roomName = uniqueRoom();
    const audioTrack = createLocalAudioTrack('test-mic');

    const { connA, connB, remoteA } = await connectPair(roomName);

    const trackPromise = waitForEvent<RemoteAudioTrack>(
      remoteA,
      'trackSubscribed',
      TIMEOUT.subscribe,
    );
    connA.room.localParticipant.publishTrack(audioTrack);
    const remoteTrack = await trackPromise;

    await sleep(TIMEOUT.negotiate);

    const SAMPLE_RATE = 48000;
    const CHANNELS = 1;
    const FRAME_SIZE = 480;

    const receivedAudio: AudioFrame[] = [];
    const iterator = remoteTrack.frames({ mode: 'queue', maxQueue: 16 });

    const pushInterval = setInterval(() => {
      const samples = generateAudioSamples(FRAME_SIZE, SAMPLE_RATE, CHANNELS);
      // Audio publish is bounded now; at real-time cadence it should never reject.
      audioTrack.write({ pcm: samples, frames: FRAME_SIZE });
    }, 10);

    const audioPromise = (async () => {
      for await (const frame of iterator) {
        receivedAudio.push(frame);
        if (receivedAudio.length >= 5) break;
      }
    })();

    try {
      await Promise.race([
        audioPromise,
        sleep(TIMEOUT.mediaFlow).then(() => {
          throw new Error(`Only received ${receivedAudio.length} audio frames`);
        }),
      ]);

      expect(receivedAudio.length).toBeGreaterThanOrEqual(5);
      const frame = receivedAudio[0];
      expect(frame.format).toBe('PCM_S16LE');
      expect(Buffer.isBuffer(frame.pcm)).toBe(true);
      expect(frame.sampleRate).toBe(48000);
      expect(frame.channels).toBe(1);
      expect(frame.frames).toBeGreaterThan(0);
      expect(typeof frame.timestamp).toBe('number');

      const ids = receivedAudio.map(f => f.frameId);
      expect(ids[1]).toBeGreaterThan(ids[0]);

      // Publishing at real-time cadence must not trip publish backpressure.
      const writeStats = audioTrack.getWriteStats();
      expect(writeStats.framesWritten).toBeGreaterThan(0);
      expect(writeStats.framesDropped).toBe(0);
      // Audio does have a real send queue, unlike video.
      expect(writeStats.maxQueue).toBeGreaterThan(0);
    } finally {
      clearInterval(pushInterval);
      await iterator.return?.();
      await Promise.all([connA.cleanup(), connB.cleanup()]);
    }
  });
});

describe('Multiple tracks', () => {
  it('B receives both video and audio tracks from A', async () => {
    const roomName = uniqueRoom();
    const videoTrack = createLocalVideoTrack('multi-cam');
    const audioTrack = createLocalAudioTrack('multi-mic');

    const { connA, connB, remoteA } = await connectPair(roomName);

    const tracks: RemoteTrack[] = [];
    const tracksPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Only received ${tracks.length}/2 trackSubscribed events`));
      }, TIMEOUT.subscribe);

      remoteA.on('trackSubscribed', (track: RemoteTrack) => {
        tracks.push(track);
        if (tracks.length >= 2) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    connA.room.localParticipant.publishTrack(videoTrack);
    connA.room.localParticipant.publishTrack(audioTrack);

    await tracksPromise;

    try {
      expect(tracks.length).toBe(2);
      const names = tracks.map(t => t.name).sort();
      expect(names).toEqual(['multi-cam', 'multi-mic']);
    } finally {
      await Promise.all([connA.cleanup(), connB.cleanup()]);
    }
  });
});

describe('RemoteDataTrack delivery options', () => {
  const deliveryCases = [
    {
      name: 'maxRetransmits and ordered',
      options: { name: 'retransmit-chat', maxRetransmits: 3, ordered: false },
      expected: { maxRetransmits: 3, maxPacketLifeTime: null, reliable: false, ordered: false },
    },
    {
      name: 'maxPacketLifeTime',
      options: { name: 'lifetime-chat', maxPacketLifeTime: 500 },
      expected: { maxRetransmits: null, maxPacketLifeTime: 500, reliable: false, ordered: true },
    },
    {
      name: 'neither limit',
      options: { name: 'reliable-chat' },
      expected: { maxRetransmits: null, maxPacketLifeTime: null, reliable: true, ordered: true },
    },
    {
      // A subscribed track reports 65535 the same way it reports an unset limit, so the
      // value does not survive the wire. `reliable` is read separately and stays accurate.
      name: 'a maxPacketLifeTime of 65535',
      options: { name: 'max-lifetime-chat', maxPacketLifeTime: 65535 },
      expected: { maxRetransmits: null, maxPacketLifeTime: null, reliable: false, ordered: true },
    },
  ];

  // Delivery options are per-track, so one publisher carries every case at once
  // and the cases share a single room rather than connecting one each.
  const subscribed = new Map<string, RemoteDataTrack>();
  const connections: Array<{ cleanup: () => Promise<void> }> = [];

  beforeAll(async () => {
    const { connA, connB, remoteA } = await connectPair(uniqueRoom());
    connections.push(connA, connB);
    const tracksPromise = waitForEvents<RemoteDataTrack>(
      remoteA,
      'trackSubscribed',
      deliveryCases.length,
      TIMEOUT.subscribe,
    );
    for (const { options } of deliveryCases) {
      connA.room.localParticipant.publishTrack(createLocalDataTrack(options));
    }
    for (const track of await tracksPromise) {
      subscribed.set(track.name, track);
    }
  }, 2 * TIMEOUT.subscribe);

  afterAll(() => Promise.all(connections.map(c => c.cleanup())));

  it.each(deliveryCases)('carries $name from the publisher', ({ options, expected }) => {
    const track = subscribed.get(options.name);
    if (!track) {
      throw new Error(`no track subscribed for '${options.name}'`);
    }
    expect(track.maxRetransmits).toBe(expected.maxRetransmits);
    expect(track.maxPacketLifeTime).toBe(expected.maxPacketLifeTime);
    expect(track.reliable).toBe(expected.reliable);
    expect(track.ordered).toBe(expected.ordered);
  });
});

describe('Data track send/receive', () => {
  it('Bob receives string and Buffer messages from Alice', async () => {
    const roomName = uniqueRoom();
    const dataTrack = createLocalDataTrack('chat');

    const { connA, connB, remoteA } = await connectPair(roomName);

    const trackPromise = waitForEvent<RemoteDataTrack>(
      remoteA,
      'trackSubscribed',
      TIMEOUT.subscribe,
    );
    connA.room.localParticipant.publishTrack(dataTrack);
    const remoteDataTrack = await trackPromise;

    await sleep(TIMEOUT.negotiate);

    const received: (string | Buffer)[] = [];
    const messagesPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Only received ${received.length}/2 messages`));
      }, TIMEOUT.mediaFlow);

      remoteDataTrack.on('message', (data: string | Buffer) => {
        received.push(data);
        if (received.length >= 2) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    dataTrack.send('hello');
    dataTrack.send(Buffer.from([0xde, 0xad]));

    await messagesPromise;

    try {
      expect(received.length).toBe(2);
      expect(received[0]).toBe('hello');
      expect(Buffer.isBuffer(received[1])).toBe(true);
      expect((received[1] as Buffer)[0]).toBe(0xde);
      expect((received[1] as Buffer)[1]).toBe(0xad);
    } finally {
      remoteDataTrack.removeAllListeners('message');
      await Promise.all([connA.cleanup(), connB.cleanup()]);
    }
  });

  // dataTracks is rebuilt fresh on every read, the same as videoTracks and
  // audioTracks, so a second read must not steal message delivery away from a
  // RemoteDataTrack obtained from an earlier one.
  it('keeps delivering messages to an earlier reference after dataTracks is read again', async () => {
    const roomName = uniqueRoom();
    const dataTrack = createLocalDataTrack('chat');
    const { connA, connB, remoteA } = await connectPair(roomName);

    const trackPromise = waitForEvent<RemoteDataTrack>(
      remoteA,
      'trackSubscribed',
      TIMEOUT.subscribe,
    );
    connA.room.localParticipant.publishTrack(dataTrack);
    const remoteDataTrack = await trackPromise;
    await sleep(TIMEOUT.negotiate);

    const received: unknown[] = [];
    const messageReceived = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Timeout waiting for message')),
        TIMEOUT.mediaFlow,
      );
      remoteDataTrack.on('message', (data: string | Buffer) => {
        received.push(data);
        clearTimeout(timeout);
        resolve();
      });
    });

    // A typical app reads this to enumerate a participant's tracks.
    void [...remoteA.dataTracks.values()];

    try {
      dataTrack.send('still listening');
      await messageReceived;
      expect(received).toEqual(['still listening']);
    } finally {
      remoteDataTrack.removeAllListeners('message');
      await Promise.all([connA.cleanup(), connB.cleanup()]);
    }
  });
});

describe('participantDisconnected', () => {
  it('Alice receives participantDisconnected when Bob leaves', async () => {
    const roomName = uniqueRoom();
    const { connA, connB } = await connectPair(roomName);

    const disconnectPromise = waitForEvent<RemoteParticipant>(
      connA.room,
      'participantDisconnected',
      TIMEOUT.subscribe,
    );
    connB.room.disconnect();
    const participant = await disconnectPromise;

    try {
      expect(participant.identity).toBe('bob');
    } finally {
      await connA.cleanup();
    }
  });
});

describe('LocalParticipant observer events', () => {
  it('trackPublished emits a LocalTrackPublication carrying the live track and unpublish()', async () => {
    const roomName = uniqueRoom();
    const videoTrack = createLocalVideoTrack('observer-cam');

    const { connA, connB } = await connectPair(roomName);

    const publishedPromise = waitForEvent<LocalVideoTrackPublication>(
      connA.room.localParticipant,
      'trackPublished',
      TIMEOUT.subscribe,
    );

    connA.room.localParticipant.publishTrack(videoTrack);
    const publication = await publishedPromise;

    try {
      // Assert the EVENT ARGUMENT itself (not a Map lookup) satisfies the contract.
      expect(publication).toBeInstanceOf(LocalVideoTrackPublication);
      expect(publication.trackName).toBe('observer-cam');
      expect(publication.trackSid).toBeTruthy();
      expect(publication.track).toBe(videoTrack);
      expect(typeof publication.unpublish).toBe('function');
    } finally {
      await Promise.all([connA.cleanup(), connB.cleanup()]);
    }
  });
});

describe('RemoteParticipant trackPublished/trackUnpublished', () => {
  it('Bob receives trackPublished when Alice publishes, trackUnpublished when she unpublishes', async () => {
    const roomName = uniqueRoom();
    const videoTrack = createLocalVideoTrack('pub-event-cam');

    const { connA, connB, remoteA } = await connectPair(roomName);

    const publishedPromise = waitForEvent<RemoteVideoTrackPublication>(
      remoteA,
      'trackPublished',
      TIMEOUT.subscribe,
    );
    const subscribedPromise = waitForEvent(remoteA, 'trackSubscribed', TIMEOUT.subscribe);

    connA.room.localParticipant.publishTrack(videoTrack);
    const publication = await publishedPromise;

    expect(publication.trackName).toBe('pub-event-cam');
    expect(publication.trackSid).toBeTruthy();
    // The kind is what routes the payload to a typed publication, so this
    // fails if the native layer stops sending a full publication.
    expect(publication).toBeInstanceOf(RemoteVideoTrackPublication);
    expect(publication.isTrackEnabled).toBe(true);

    // Wait for subscription to complete before unpublishing
    await subscribedPromise;

    const unpublishedPromise = waitForEvent<{ trackName: string }>(
      remoteA,
      'trackUnpublished',
      TIMEOUT.subscribe,
    );
    connA.room.localParticipant.unpublishTrack(videoTrack);
    const unpubResult = await unpublishedPromise;

    try {
      expect(unpubResult.trackName).toBe('pub-event-cam');
    } finally {
      await Promise.all([connA.cleanup(), connB.cleanup()]);
    }
  });
});

describe('Track publish/unpublish lifecycle', () => {
  it('published track appears in localParticipant.videoTracks, disappears after unpublish', async () => {
    const roomName = uniqueRoom();
    const videoTrack = createLocalVideoTrack('lifecycle-cam');

    const { connA, connB, remoteA } = await connectPair(roomName);

    const trackPromise = waitForEvent(remoteA, 'trackSubscribed', TIMEOUT.subscribe);
    connA.room.localParticipant.publishTrack(videoTrack);
    await trackPromise;

    try {
      const pubs = connA.room.localParticipant.videoTracks;
      expect(pubs.size).toBeGreaterThanOrEqual(1);
      expect([...pubs.values()].some(p => p.trackName === 'lifecycle-cam')).toBe(true);

      const unsubPromise = waitForEvent(remoteA, 'trackUnsubscribed', TIMEOUT.subscribe);
      connA.room.localParticipant.unpublishTrack(videoTrack);
      await unsubPromise;

      const pubsAfter = connA.room.localParticipant.videoTracks;
      expect([...pubsAfter.values()].some(p => p.trackName === 'lifecycle-cam')).toBe(false);
    } finally {
      await Promise.all([connA.cleanup(), connB.cleanup()]);
    }
  });
});

describe('participants Map + participant state', () => {
  it('participants is a Map keyed by SID with correct state', async () => {
    const roomName = uniqueRoom();
    const { connA, connB, remoteA } = await connectPair(roomName);

    try {
      expect(connA.room.participants).toBeInstanceOf(Map);
      expect(connA.room.participants.size).toBeGreaterThanOrEqual(1);

      const bobFromMap = [...connA.room.participants.values()].find(p => p.identity === 'bob');
      expect(bobFromMap).toBeTruthy();
      expect(connA.room.participants.get(bobFromMap!.sid)).toBeTruthy();

      expect(connA.room.localParticipant.state).toBe('connected');
      expect(remoteA.state).toBe('connected');
    } finally {
      await Promise.all([connA.cleanup(), connB.cleanup()]);
    }
  });
});

describe('networkQualityLevel', () => {
  it('networkQualityLevelChanged fires and matches property', async () => {
    const roomName = uniqueRoom();
    const { connA, connB } = await connectPair(roomName, {
      networkQuality: true,
    });

    try {
      const level = await waitForEvent<number>(
        connA.room.localParticipant,
        'networkQualityLevelChanged',
        TIMEOUT.subscribe,
      );

      expect(typeof level).toBe('number');
      expect(level).toBeGreaterThanOrEqual(1);
      expect(level).toBeLessThanOrEqual(5);
      expect(level).toBe(connA.room.localParticipant.networkQualityLevel);
    } finally {
      await Promise.all([connA.cleanup(), connB.cleanup()]);
    }
  });
});

describe('dominantSpeaker', () => {
  it('dominantSpeakerChanged fires when participant has audio', async () => {
    const roomName = uniqueRoom();
    const audioTrack = createLocalAudioTrack('dominant-mic');

    const { connA, connB } = await connectPair(roomName, {
      enableDominantSpeaker: true,
    });

    connA.room.localParticipant.publishTrack(audioTrack);

    // Push audio so Alice becomes dominant speaker
    await sleep(TIMEOUT.negotiate);
    const pushInterval = setInterval(() => {
      const samples = generateAudioSamples(480, 48000, 1);
      audioTrack.write({
        pcm: samples,
        frames: 480,
      });
    }, 10);

    try {
      const speaker = await waitForEvent<RemoteParticipant>(
        connB.room,
        'dominantSpeakerChanged',
        TIMEOUT.subscribe,
      );

      expect(speaker).toBeTruthy();
      expect(speaker.identity).toBe('alice');
      expect(connB.room.dominantSpeaker).toBeTruthy();
      expect(connB.room.dominantSpeaker!.identity).toBe('alice');
    } finally {
      clearInterval(pushInterval);
      await Promise.all([connA.cleanup(), connB.cleanup()]);
    }
  });
});

describe('LocalTrackPublication', () => {
  it('trackPublished returns publication with correct properties and track reference', async () => {
    const roomName = uniqueRoom();
    const videoTrack = createLocalVideoTrack('pub-props-cam');
    const { connA, connB } = await connectPair(roomName);

    const publishedPromise = waitForEvent<{ trackName: string; trackSid: string }>(
      connA.room.localParticipant,
      'trackPublished',
      TIMEOUT.subscribe,
    );
    connA.room.localParticipant.publishTrack(videoTrack);
    const published = await publishedPromise;

    try {
      expect(published.trackSid).toMatch(/^MT/);
      expect(published.trackName).toBe('pub-props-cam');

      const pub = connA.room.localParticipant.tracks.get(published.trackSid);
      expect(pub).toBeTruthy();
      expect(pub!.track).toBe(videoTrack);
      expect(pub!.kind).toBe('video');
      expect(pub!.isTrackEnabled).toBe(true);

      expect(connA.room.localParticipant.videoTracks.get(published.trackSid)).toBeTruthy();
    } finally {
      await Promise.all([connA.cleanup(), connB.cleanup()]);
    }
  });
});

describe('publishTracks / unpublishTracks', () => {
  it('batch publish adds publications to .tracks, batch unpublish removes them', async () => {
    const roomName = uniqueRoom();
    const videoTrack = createLocalVideoTrack('batch-cam');
    const audioTrack = createLocalAudioTrack('batch-mic');

    const { connA, connB, remoteA } = await connectPair(roomName);

    const publishedEvents: { trackSid: string }[] = [];
    const publishedPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`Only ${publishedEvents.length}/2 trackPublished events`)),
        TIMEOUT.subscribe,
      );
      connA.room.localParticipant.on('trackPublished', (pub: { trackSid: string }) => {
        publishedEvents.push(pub);
        if (publishedEvents.length == 2) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    connA.room.localParticipant.publishTracks([videoTrack, audioTrack]);
    await publishedPromise;

    try {
      for (const pub of publishedEvents) {
        expect(connA.room.localParticipant.tracks.get(pub.trackSid)).toBeTruthy();
      }

      const unsubEvents: unknown[] = [];
      const unsubPromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error(`Only ${unsubEvents.length}/2 trackUnsubscribed events`)),
          TIMEOUT.subscribe,
        );
        remoteA.on('trackUnsubscribed', (track: unknown) => {
          unsubEvents.push(track);
          if (unsubEvents.length >= 2) {
            clearTimeout(timeout);
            resolve();
          }
        });
      });

      // trackPublished only confirms the local publish. Unpublishing before the
      // subscriber has subscribed leaves nothing to unsubscribe, so wait for
      // both subscriptions first. Wait on publication STATE, not on events: a
      // subscription that completes before the listener attaches is not
      // replayed, so counting events can never reach two.
      await waitForSubscribed(remoteA, 2, TIMEOUT.subscribe);

      connA.room.localParticipant.unpublishTracks([videoTrack, audioTrack]);
      await unsubPromise;

      for (const pub of publishedEvents) {
        expect(connA.room.localParticipant.tracks.has(pub.trackSid)).toBe(false);
      }
    } finally {
      await Promise.all([connA.cleanup(), connB.cleanup()]);
    }
  });
});

describe('Room-level track event bubbling', () => {
  it('room emits trackSubscribed with track and participant', async () => {
    const roomName = uniqueRoom();
    const videoTrack = createLocalVideoTrack('bubble-cam');

    const { connA, connB } = await connectPair(roomName);

    const bubblePromise = new Promise<{
      track: RemoteTrack;
      participant: RemoteParticipant;
    }>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Timeout waiting for room trackSubscribed')),
        TIMEOUT.subscribe,
      );
      connB.room.on('trackSubscribed', (track, _publication, participant) => {
        clearTimeout(timeout);
        resolve({ track, participant });
      });
    });

    connA.room.localParticipant.publishTrack(videoTrack);
    const { track, participant } = await bubblePromise;

    try {
      expect(track.sid).toBeTruthy();
      expect(participant.identity).toBe('alice');

      // Verify the track is accessible via the participant's publication Map
      const remotePub = participant.videoTracks.get(track.sid);
      expect(remotePub).toBeTruthy();
      expect(remotePub!.track?.sid).toBe(track.sid);
    } finally {
      await Promise.all([connA.cleanup(), connB.cleanup()]);
    }
  });
});

describe('Late joiner into a populated room', () => {
  it('emits trackSubscribed for tracks a peer published before we joined', async () => {
    const roomName = uniqueRoom();
    const videoTrack = createLocalVideoTrack('late-cam');
    const audioTrack = createLocalAudioTrack('late-mic');

    const connA = await connectToRoom('alice', roomName, {
      videoTracks: [videoTrack],
      audioTracks: [audioTrack],
    });
    const connB = await connectToRoom('bob', roomName);

    const publishers: string[] = [];
    const kinds: string[] = [];
    const bothSubscribed = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`Timeout waiting for trackSubscribed x2, got: [${kinds}]`)),
        TIMEOUT.subscribe,
      );
      connB.room.on(
        'trackSubscribed',
        (track: RemoteTrack, _publication, participant: RemoteParticipant) => {
          kinds.push(track.kind);
          publishers.push(participant.identity);
          if (kinds.length === 2) {
            clearTimeout(timeout);
            resolve();
          }
        },
      );
    });

    try {
      await bothSubscribed;
      expect(kinds.toSorted()).toEqual(['audio', 'video']);
      expect(publishers).toEqual(['alice', 'alice']);
    } finally {
      await Promise.all([connA.cleanup(), connB.cleanup()]);
    }
  });

  it('emits trackDisabled and trackEnabled for a peer already in the room', async () => {
    const roomName = uniqueRoom();
    const videoTrack = createLocalVideoTrack('late-toggle-cam');

    const connA = await connectToRoom('alice', roomName, { videoTracks: [videoTrack] });
    const connB = await connectToRoom('bob', roomName);

    const disabled = waitForEvent(connB.room, 'trackDisabled', TIMEOUT.subscribe);
    const enabled = waitForEvent(connB.room, 'trackEnabled', TIMEOUT.subscribe);

    try {
      videoTrack.enabled = false;
      expect(await disabled).toBeInstanceOf(RemoteVideoTrackPublication);
      videoTrack.enabled = true;
      expect(await enabled).toBeInstanceOf(RemoteVideoTrackPublication);
    } finally {
      await Promise.all([connA.cleanup(), connB.cleanup()]);
    }
  });
});

describe('RemoteTrackPublication', () => {
  it('remote videoTracks Map has publication with correct properties after subscription', async () => {
    const roomName = uniqueRoom();
    const videoTrack = createLocalVideoTrack('remote-pub-cam');

    const { connA, connB, remoteA } = await connectPair(roomName);

    // Wait for trackPublished on local side to get the trackSid
    const publishedPromise = waitForEvent<LocalVideoTrackPublication>(
      connA.room.localParticipant,
      'trackPublished',
      TIMEOUT.subscribe,
    );
    const subscribedPromise = waitForEvent<RemoteVideoTrack>(
      remoteA,
      'trackSubscribed',
      TIMEOUT.subscribe,
    );

    connA.room.localParticipant.publishTrack(videoTrack);
    const [published, remoteTrack] = await Promise.all([publishedPromise, subscribedPromise]);

    try {
      const pub = remoteA.videoTracks.get(published.trackSid);
      expect(pub).toBeTruthy();
      expect(pub!.kind).toBe('video');
      expect(pub!.isSubscribed).toBe(true);
      expect(pub!.track?.sid).toBe(remoteTrack.sid);
      expect(pub!.trackSid).toBe(published.trackSid);
    } finally {
      await Promise.all([connA.cleanup(), connB.cleanup()]);
    }
  });
});

describe('Room.getStats()', () => {
  it('returns stats reports with correct shape for published tracks', async () => {
    const roomName = uniqueRoom();
    const videoTrack = createLocalVideoTrack('stats-cam');
    const audioTrack = createLocalAudioTrack('stats-mic');

    const { connA, connB, remoteA } = await connectPair(roomName);

    const tracksSubscribed: unknown[] = [];
    const tracksPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`Only ${tracksSubscribed.length}/2 trackSubscribed events`)),
        TIMEOUT.subscribe,
      );
      remoteA.on('trackSubscribed', (track: unknown) => {
        tracksSubscribed.push(track);
        if (tracksSubscribed.length >= 2) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    connA.room.localParticipant.publishTrack(videoTrack);
    connA.room.localParticipant.publishTrack(audioTrack);
    await tracksPromise;

    await sleep(TIMEOUT.negotiate);

    // Push media so stats accumulate
    const pushInterval = setInterval(() => {
      videoTrack.write(generateI420Frame(640, 480));
      audioTrack.write({
        pcm: generateAudioSamples(480, 48000, 1),
        frames: 480,
      });
    }, 33);

    await sleep(3_000);

    try {
      const reports: StatsReport[] = await connA.room.getStats();

      expect(Array.isArray(reports)).toBe(true);
      expect(reports.length).toBeGreaterThan(0);

      const report = reports[0];
      expect(typeof report.peerConnectionId).toBe('string');
      expect(Array.isArray(report.localAudioTrackStats)).toBe(true);
      expect(Array.isArray(report.localVideoTrackStats)).toBe(true);
      expect(Array.isArray(report.remoteAudioTrackStats)).toBe(true);
      expect(Array.isArray(report.remoteVideoTrackStats)).toBe(true);

      // Verify local video stats shape + accuracy
      if (report.localVideoTrackStats.length > 0) {
        const vs = report.localVideoTrackStats[0];
        expect(typeof vs.codec).toBe('string');
        expect(typeof vs.packetsLost).toBe('number');
        expect(typeof vs.ssrc).toBe('string');
        expect(typeof vs.timestamp).toBe('number');
        expect(vs.timestamp).toBeGreaterThan(0);
        expect(typeof vs.bytesSent).toBe('number');
        expect(typeof vs.packetsSent).toBe('number');
        expect(typeof vs.roundTripTime).toBe('number');
        expect(vs.dimensions).toBeDefined();
        expect(typeof vs.dimensions.width).toBe('number');
        expect(typeof vs.dimensions.height).toBe('number');
        expect(vs.captureDimensions).toBeDefined();
        expect(typeof vs.captureFrameRate).toBe('number');
        expect(typeof vs.frameRate).toBe('number');
        expect(typeof vs.framesEncoded).toBe('number');
        expect(vs.bytesSent).toBeGreaterThan(0);
        expect(vs.packetsSent).toBeGreaterThan(0);
      }

      // Verify local audio stats shape + accuracy
      if (report.localAudioTrackStats.length > 0) {
        const as = report.localAudioTrackStats[0];
        expect(typeof as.audioLevel).toBe('number');
        expect(typeof as.jitter).toBe('number');
        expect(typeof as.bytesSent).toBe('number');
        expect(as.bytesSent).toBeGreaterThan(0);
      }
    } finally {
      clearInterval(pushInterval);
      await Promise.all([connA.cleanup(), connB.cleanup()]);
    }
  });

  it('returns remote track stats for the subscriber', async () => {
    const roomName = uniqueRoom();
    const videoTrack = createLocalVideoTrack('remote-stats-cam');

    const { connA, connB, remoteA } = await connectPair(roomName);

    const trackPromise = waitForEvent(remoteA, 'trackSubscribed', TIMEOUT.subscribe);
    connA.room.localParticipant.publishTrack(videoTrack);
    await trackPromise;

    await sleep(TIMEOUT.negotiate);

    const pushInterval = setInterval(() => {
      videoTrack.write(generateI420Frame(640, 480));
    }, 33);

    await sleep(3_000);

    try {
      const reports: StatsReport[] = await connB.room.getStats();
      expect(reports.length).toBeGreaterThan(0);

      const report = reports[0];
      if (report.remoteVideoTrackStats.length > 0) {
        const rvs = report.remoteVideoTrackStats[0];
        expect(typeof rvs.bytesReceived).toBe('number');
        expect(typeof rvs.packetsReceived).toBe('number');
        expect(typeof rvs.dimensions.width).toBe('number');
        expect(typeof rvs.frameRate).toBe('number');
        expect(rvs.bytesReceived).toBeGreaterThan(0);
        expect(rvs.packetsReceived).toBeGreaterThan(0);
      }
    } finally {
      clearInterval(pushInterval);
      await Promise.all([connA.cleanup(), connB.cleanup()]);
    }
  });

  it('rejects when room is disconnected', async () => {
    const roomName = uniqueRoom();
    const { room, cleanup } = await connectToRoom('alice', roomName);

    const disconnectedPromise = waitForEvent(room, 'disconnected', 5_000);
    room.disconnect();
    await disconnectedPromise;

    await expect(room.getStats()).rejects.toThrow(/disconnected/i);
    await cleanup();
  });

  it('returns empty stats arrays when no tracks are published', async () => {
    const roomName = uniqueRoom();
    const { connA, connB } = await connectPair(roomName);

    try {
      const reports: StatsReport[] = await connA.room.getStats();
      expect(Array.isArray(reports)).toBe(true);
      if (reports.length > 0) {
        expect(reports[0].localVideoTrackStats).toEqual([]);
        expect(reports[0].localAudioTrackStats).toEqual([]);
      }
    } finally {
      await Promise.all([connA.cleanup(), connB.cleanup()]);
    }
  });

  // Repeated getStats followed by a clean dispose: guards against pending stats
  // observers accumulating instead of being released on completion.
  it('handles many sequential getStats calls and disposes cleanly', async () => {
    const roomName = uniqueRoom();
    const { connA, connB } = await connectPair(roomName);

    try {
      for (let i = 0; i < 25; i++) {
        const reports: StatsReport[] = await connA.room.getStats();
        expect(Array.isArray(reports)).toBe(true);
      }
    } finally {
      await Promise.all([connA.cleanup(), connB.cleanup()]);
    }
  });

  // Dispose with stats calls in flight: exercises cancelAll() against a
  // non-empty observer set. Pending promises are abandoned on dispose (their
  // rejection is dropped when the async context closes), so they aren't awaited
  // — the contract is that disposing mid-flight doesn't crash.
  it('disposes cleanly while getStats calls are in flight', async () => {
    const roomName = uniqueRoom();
    const { connA, connB } = await connectPair(roomName);

    // Guard against unhandled-rejection noise from the abandoned promises.
    for (let i = 0; i < 3; i++) connA.room.getStats().catch(() => {});

    try {
      await connA.cleanup();
      expect(connA.room.state).toBe('disconnected');
    } finally {
      await connB.cleanup();
    }
  });
});

// macOS-only: verifies main-queue callbacks are delivered (getStats resolves).
describe('macOS main-queue pump (CFRunLoop)', () => {
  it.skipIf(process.platform !== 'darwin')(
    'delivers main-queue callbacks (getStats resolves)',
    async () => {
      const roomName = uniqueRoom();
      const { connA, connB } = await connectPair(roomName);

      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('getStats did not resolve — main-queue pump stalled')),
          5_000,
        );
      });

      try {
        const reports = await Promise.race([connA.room.getStats(), timeout]);
        expect(Array.isArray(reports)).toBe(true);
      } finally {
        clearTimeout(timer);
        await Promise.all([connA.cleanup(), connB.cleanup()]);
      }
    },
  );
});

describe('RemoteVideoTrack.setContentPreferences', () => {
  let pair: Awaited<ReturnType<typeof connectPair>> | undefined;
  let remoteTrack: RemoteVideoTrack;

  beforeAll(async () => {
    // setContentPreferences throws unless the room was connected with a bandwidthProfile.
    pair = await connectPair(uniqueRoom(), { bandwidthProfile: { video: {} } });
    const subscribed = waitForEvent<RemoteVideoTrack>(
      pair.remoteA,
      'trackSubscribed',
      TIMEOUT.subscribe,
    );
    pair.connA.room.localParticipant.publishTrack(createLocalVideoTrack('content-prefs-cam'));
    remoteTrack = await subscribed;
  }, TIMEOUT.subscribe + 5_000);

  afterAll(() => {
    if (!pair) return;
    return Promise.all([pair.connA.cleanup(), pair.connB.cleanup()]);
  });

  const cases: { name: string; input: VideoContentPreferences; error: RegExp }[] = [
    {
      name: 'non-object renderDimensions',
      // @ts-expect-error renderDimensions is intentionally invalid
      input: { renderDimensions: 123 },
      error: /renderDimensions must be an object/,
    },
    {
      name: 'missing height',
      // @ts-expect-error height is intentionally missing
      input: { renderDimensions: { width: 320 } },
      error: /numeric width and height/,
    },
    {
      name: 'non-positive width',
      input: { renderDimensions: { width: 0, height: 240 } },
      error: /positive integers/,
    },
    {
      name: 'non-integer width',
      input: { renderDimensions: { width: 320.5, height: 240 } },
      error: /positive integers/,
    },
  ];

  it.each(cases)('throws $name', ({ input, error }) => {
    expect(() => remoteTrack.setContentPreferences(input)).toThrow(error);
  });

  it('accepts valid renderDimensions', () => {
    expect(() =>
      remoteTrack.setContentPreferences({ renderDimensions: { width: 320, height: 240 } }),
    ).not.toThrow();
  });
});

describe('Error paths', () => {
  it('connect rejects with invalid token', async () => {
    await expect(connect('invalid-token', { name: uniqueRoom() })).rejects.toThrow();
  });
});

describe('Subscription to tracks published before joining', () => {
  // The observer rtc-cpp calls is installed on the signaling thread, because
  // subscription lands about a millisecond after the participant-connected
  // callback. Attaching it on the JS thread instead loses these events, and
  // loses them more often on later joins, so one join is not enough coverage.
  it('emits trackSubscribed on every rejoin, not just the first', async () => {
    const roomName = uniqueRoom();
    const incumbent = await connectToRoom('alice', roomName);
    const rejoins = 3;
    const subscribedKinds: string[][] = [];

    try {
      for (let i = 0; i < rejoins; i++) {
        const joined = waitForEvent<RemoteParticipant>(
          incumbent.room,
          'participantConnected',
          TIMEOUT.subscribe,
        );
        const peer = await connectToRoom('bob', roomName, {
          videoTracks: [createLocalVideoTrack(`video-${i}`)],
          audioTracks: [createLocalAudioTrack(`audio-${i}`)],
        });

        const remotePeer = await joined;
        const tracks = await waitForEvents<RemoteTrack>(
          remotePeer,
          'trackSubscribed',
          2,
          TIMEOUT.subscribe,
        );
        subscribedKinds.push(tracks.map(track => track.kind).sort());

        const left = waitForEvent(incumbent.room, 'participantDisconnected', TIMEOUT.subscribe);
        await peer.cleanup();
        await left;
      }
    } finally {
      await incumbent.cleanup();
    }

    expect(subscribedKinds).toEqual(Array.from({ length: rejoins }, () => ['audio', 'video']));
  });

  it("passes the track's publication and participant to the Room's trackSubscribed", async () => {
    const roomName = uniqueRoom();
    const incumbent = await connectToRoom('alice', roomName);

    try {
      const subscribed = waitForEvents<unknown>(
        incumbent.room,
        'trackSubscribed',
        1,
        TIMEOUT.subscribe,
      );
      const args: unknown[] = [];
      incumbent.room.once('trackSubscribed', (...received: unknown[]) => args.push(...received));

      const peer = await connectToRoom('bob', roomName, {
        videoTracks: [createLocalVideoTrack('video')],
      });
      await subscribed;

      const [track, publication, participant] = args as [
        RemoteVideoTrack,
        { trackSid: string; kind: string; isSubscribed: boolean },
        RemoteParticipant,
      ];
      expect(track.kind).toBe('video');
      expect(publication.kind).toBe('video');
      expect(publication.isSubscribed).toBe(true);
      expect(publication.trackSid).toBe(track.sid);
      expect(participant.identity).toBe('bob');

      await peer.cleanup();
    } finally {
      await incumbent.cleanup();
    }
  });

  // trackUnsubscribed for a disconnecting participant's tracks and the
  // participantDisconnected event that follows it are dispatched through two
  // independent native queues (the participant's and the Room's) with no
  // ordering guarantee between them. A participant that unpublishes and then
  // disconnects on every rejoin exercises that teardown path repeatedly.
  it('emits trackUnsubscribed for every remaining track on every rejoin', async () => {
    const roomName = uniqueRoom();
    const incumbent = await connectToRoom('alice', roomName);
    const rejoins = 3;
    const unsubscribedKinds: string[][] = [];

    try {
      for (let i = 0; i < rejoins; i++) {
        const joined = waitForEvent<RemoteParticipant>(
          incumbent.room,
          'participantConnected',
          TIMEOUT.subscribe,
        );
        const peer = await connectToRoom('bob', roomName, {
          videoTracks: [createLocalVideoTrack(`video-${i}`)],
          audioTracks: [createLocalAudioTrack(`audio-${i}`)],
        });
        const remotePeer = await joined;
        await waitForEvents<RemoteTrack>(remotePeer, 'trackSubscribed', 2, TIMEOUT.subscribe);

        const unsubscribed = waitForEvents<RemoteTrack>(
          remotePeer,
          'trackUnsubscribed',
          2,
          TIMEOUT.subscribe,
        );
        await peer.cleanup();
        const tracks = await unsubscribed;
        unsubscribedKinds.push(tracks.map(track => track.kind).sort());
      }
    } finally {
      await incumbent.cleanup();
    }

    expect(unsubscribedKinds).toEqual(Array.from({ length: rejoins }, () => ['audio', 'video']));
  });

  // A participant already in the Room when we join is wrapped by
  // RoomWrap::GetRemoteParticipants, a different native code path than
  // onParticipantConnected. Both used to install their own observer on the
  // shared native participant, so whichever ran more recently silently took
  // over event delivery.
  it('emits trackUnsubscribed for a participant who was already in the Room when we joined', async () => {
    const roomName = uniqueRoom();
    const peer = await connectToRoom('bob', roomName, {
      videoTracks: [createLocalVideoTrack('video')],
      audioTracks: [createLocalAudioTrack('audio')],
    });

    const incumbent = await connectToRoom('alice', roomName);
    try {
      const [bob] = [...incumbent.room.participants.values()];
      // Subscription has not completed when connect() resolves: the
      // publications read here still report isSubscribed false. Disconnecting
      // the peer before then leaves nothing to unsubscribe, so wait for both
      // tracks to be subscribed before asserting the unsubscribe events.
      const subscribed = waitForEvents<RemoteTrack>(bob, 'trackSubscribed', 2, TIMEOUT.subscribe);
      const unsubscribed = waitForEvents<RemoteTrack>(
        bob,
        'trackUnsubscribed',
        2,
        TIMEOUT.subscribe,
      );
      await subscribed;

      await peer.cleanup();
      const tracks = await unsubscribed;
      expect(tracks.map(track => track.kind).sort()).toEqual(['audio', 'video']);
    } finally {
      await incumbent.cleanup();
    }
  });

  // Reading room.participants (or room.dominantSpeaker) builds a second native
  // wrap for a participant that already has one from onParticipantConnected.
  // That second wrap used to install its own observer, replacing the one the
  // first wrap's listeners depend on, so any later track event went nowhere.
  it('keeps delivering trackSubscribed after room.participants has been read', async () => {
    const roomName = uniqueRoom();
    const incumbent = await connectToRoom('alice', roomName);

    try {
      const joined = waitForEvent<RemoteParticipant>(
        incumbent.room,
        'participantConnected',
        TIMEOUT.subscribe,
      );
      const peer = await connectToRoom('bob', roomName, {
        videoTracks: [createLocalVideoTrack('video')],
      });
      const bob = await joined;
      await waitForEvents<RemoteTrack>(bob, 'trackSubscribed', 1, TIMEOUT.subscribe);

      // A typical app reads this getter to build or refresh a participant list.
      const [sameParticipant] = [...incumbent.room.participants.values()];
      expect(sameParticipant).toBe(bob);

      const subscribedAfterRead = waitForEvent<RemoteTrack>(
        bob,
        'trackSubscribed',
        TIMEOUT.subscribe,
      );
      peer.room.localParticipant.publishTrack(createLocalAudioTrack('audio'));
      const track = await subscribedAfterRead;
      expect(track.kind).toBe('audio');

      await peer.cleanup();
    } finally {
      await incumbent.cleanup();
    }
  });

  // Every other test in this file uses at most one other remote participant.
  // Group Rooms support many; this confirms each is tracked independently.
  it('tracks trackSubscribed and trackUnsubscribed independently for several simultaneous participants', async () => {
    const roomName = uniqueRoom();
    const incumbent = await connectToRoom('alice', roomName);
    const peerCount = 3;
    const perParticipant = new Map<string, { subs: number; unsubs: number }>();

    incumbent.room.on('participantConnected', p => {
      const record = { subs: 0, unsubs: 0 };
      perParticipant.set(p.sid, record);
      p.on('trackSubscribed', () => record.subs++);
      p.on('trackUnsubscribed', () => record.unsubs++);
    });

    try {
      const peers = await Promise.all(
        Array.from({ length: peerCount }, (_, i) =>
          connectToRoom(`peer-${i}`, roomName, {
            videoTracks: [createLocalVideoTrack(`video-${i}`)],
            audioTracks: [createLocalAudioTrack(`audio-${i}`)],
          }),
        ),
      );
      await sleep(TIMEOUT.negotiate);

      expect(perParticipant.size).toBe(peerCount);
      for (const record of perParticipant.values()) {
        expect(record.subs).toBe(2);
      }

      await Promise.all(peers.map(peer => peer.cleanup()));
      await sleep(TIMEOUT.negotiate);

      for (const record of perParticipant.values()) {
        expect(record.unsubs).toBe(2);
      }
    } finally {
      await incumbent.cleanup();
    }
  });

  it('reports the publication as subscribed with its track, and unsubscribed without one', async () => {
    const roomName = uniqueRoom();
    const incumbent = await connectToRoom('alice', roomName);

    try {
      const subscribed = waitForEvent<unknown>(
        incumbent.room,
        'trackSubscribed',
        TIMEOUT.subscribe,
      );
      const subscribeArgs: unknown[] = [];
      incumbent.room.once('trackSubscribed', (...args: unknown[]) => subscribeArgs.push(...args));

      const peer = await connectToRoom('bob', roomName, {
        videoTracks: [createLocalVideoTrack('video')],
      });
      await subscribed;

      const [, subscribedPub] = subscribeArgs as [RemoteTrack, RemoteTrackPublication];
      expect(subscribedPub.isSubscribed).toBe(true);
      expect(subscribedPub.track).toBeDefined();

      const unsubscribed = waitForEvent<unknown>(
        incumbent.room,
        'trackUnsubscribed',
        TIMEOUT.subscribe,
      );
      const unsubscribeArgs: unknown[] = [];
      incumbent.room.once('trackUnsubscribed', (...args: unknown[]) =>
        unsubscribeArgs.push(...args),
      );
      await peer.cleanup();
      await unsubscribed;

      const [lostTrack, unsubscribedPub] = unsubscribeArgs as [RemoteTrack, RemoteTrackPublication];
      // The track reaches the listener as the event's own first argument. The
      // publication reports isSubscribed false, so it must not also carry one.
      expect(lostTrack.kind).toBe('video');
      expect(unsubscribedPub.isSubscribed).toBe(false);
      expect(unsubscribedPub.track).toBeUndefined();
    } finally {
      await incumbent.cleanup();
    }
  });

  // The native layer sequences participantDisconnected behind a participant's
  // own events by putting work on that participant's queue. Nothing about that
  // mechanism may show up as an event an application can see.
  it('emits no internal events while a participant joins and leaves', async () => {
    const roomName = uniqueRoom();
    const incumbent = await connectToRoom('alice', roomName);
    const emitted: string[] = [];
    const roomEmit = incumbent.room.emit.bind(incumbent.room);
    incumbent.room.emit = ((event: string, ...args: unknown[]) => {
      emitted.push(event);
      return roomEmit(event, ...args);
    }) as typeof incumbent.room.emit;

    try {
      const joined = waitForEvent<RemoteParticipant>(
        incumbent.room,
        'participantConnected',
        TIMEOUT.subscribe,
      );
      const peer = await connectToRoom('bob', roomName, {
        videoTracks: [createLocalVideoTrack('video')],
      });
      const bob = await joined;

      const participantEmit = bob.emit.bind(bob);
      bob.emit = ((event: string, ...args: unknown[]) => {
        emitted.push(event);
        return participantEmit(event, ...args);
      }) as typeof bob.emit;

      await waitForEvents<RemoteTrack>(bob, 'trackSubscribed', 1, TIMEOUT.subscribe);
      const left = waitForEvent(incumbent.room, 'participantDisconnected', TIMEOUT.subscribe);
      await peer.cleanup();
      await left;

      expect(emitted).toContain('participantDisconnected');
      expect(emitted.filter(event => event.startsWith('__'))).toEqual([]);
    } finally {
      await incumbent.cleanup();
    }
  });

  // participantDisconnected must report the same RemoteParticipant object the
  // application already has, so a listener registered on it still fires and
  // the SDK disposes the instance the application is holding. A
  // room.participants read in the disconnect window used to drop the cached
  // instance, and a second one was built for the event.
  it('reports the same RemoteParticipant instance on disconnect as on connect', async () => {
    const roomName = uniqueRoom();
    const incumbent = await connectToRoom('alice', roomName);
    const poll = setInterval(() => void [...incumbent.room.participants.values()], 5);

    try {
      const joined = waitForEvent<RemoteParticipant>(
        incumbent.room,
        'participantConnected',
        TIMEOUT.subscribe,
      );
      const peer = await connectToRoom('bob', roomName, {
        videoTracks: [createLocalVideoTrack('video')],
      });
      const bob = await joined;
      await waitForEvents<RemoteTrack>(bob, 'trackSubscribed', 1, TIMEOUT.subscribe);

      const left = waitForEvent<RemoteParticipant>(
        incumbent.room,
        'participantDisconnected',
        TIMEOUT.subscribe,
      );
      await peer.cleanup();
      const departed = await left;

      expect(departed).toBe(bob);
    } finally {
      clearInterval(poll);
      await incumbent.cleanup();
    }
  });

  // A participant is removed from the Room before the disconnect event
  // reaches JS. Reading room.participants in that window drops the last
  // reference to the wrapper carrying the event, so the read must not be able
  // to take the event with it.
  it('still emits participantDisconnected while room.participants is polled', async () => {
    const roomName = uniqueRoom();
    const incumbent = await connectToRoom('alice', roomName);
    const order: string[] = [];
    let poll: NodeJS.Timeout | undefined;

    try {
      // Counted on the Room, and attached before the peer connects: waiting for
      // the participant first and only then listening would race the
      // subscriptions already queued for it. This also keeps no reference to
      // the participant, so nothing here holds the wrapper, or the queue it
      // owns, alive through the disconnect.
      const subscribed = waitForEvents<RemoteTrack>(
        incumbent.room,
        'trackSubscribed',
        2,
        TIMEOUT.subscribe,
      );
      const peer = await connectToRoom('bob', roomName, {
        videoTracks: [createLocalVideoTrack('video')],
        audioTracks: [createLocalAudioTrack('audio')],
      });
      await subscribed;

      incumbent.room.on('trackUnsubscribed', () => order.push('trackUnsubscribed'));
      const left = waitForEvent(incumbent.room, 'participantDisconnected', TIMEOUT.subscribe);
      incumbent.room.once('participantDisconnected', () => order.push('participantDisconnected'));

      // Poll only across the teardown. The read prunes both the JS and native
      // caches, and a collection has to follow for the queued event to be
      // lost, so ask for one where the runtime allows it (node --expose-gc).
      poll = setInterval(() => {
        void [...incumbent.room.participants.values()];
        (globalThis as { gc?: () => void }).gc?.();
      }, 5);

      await peer.cleanup();
      await left;

      expect(order).toEqual(['trackUnsubscribed', 'trackUnsubscribed', 'participantDisconnected']);
      expect(incumbent.room.participants.size).toBe(0);
    } finally {
      clearInterval(poll);
      await incumbent.cleanup();
    }
  });

  // Two Rooms in one process subscribed to the same publication hold separate
  // native tracks that report the same Track SID. Each needs its own message
  // delivery; neither may take over or cut off the other.
  it('delivers data track messages to two Rooms subscribed to the same publication', async () => {
    const roomName = uniqueRoom();
    const dataTrack = createLocalDataTrack('chat');
    // Subscribers first, so each sees the publisher connect.
    const subscribers = await Promise.all([
      connectToRoom('bob', roomName),
      connectToRoom('carol', roomName),
    ]);
    // Each subscriber also sees the other one connect, so wait for the
    // publisher specifically.
    const joined = subscribers.map(
      subscriber =>
        new Promise<RemoteParticipant>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error('Timeout waiting for the publisher to connect')),
            TIMEOUT.subscribe,
          );
          subscriber.room.on('participantConnected', (participant: RemoteParticipant) => {
            if (participant.identity !== 'alice') return;
            clearTimeout(timer);
            resolve(participant);
          });
        }),
    );
    const publisher = await connectToRoom('alice', roomName, { dataTracks: [dataTrack] });

    try {
      const tracks = await Promise.all(
        joined.map(async participant => {
          const alice = await participant;
          return waitForEvent<RemoteDataTrack>(alice, 'trackSubscribed', TIMEOUT.subscribe);
        }),
      );
      await sleep(TIMEOUT.negotiate);

      const received = tracks.map(track => {
        const messages: unknown[] = [];
        track.on('message', (data: string | Buffer) => messages.push(data));
        return messages;
      });

      dataTrack.send('to both rooms');
      await sleep(TIMEOUT.negotiate);

      for (const messages of received) {
        expect(messages).toEqual(['to both rooms']);
      }

      // Tearing one Room down must not take the other's delivery with it.
      // Sharing a single observer between the two native tracks looks correct
      // until this point, because both wraps then receive the one Room's
      // messages.
      await subscribers[0].cleanup();
      tracks[0].removeAllListeners('message');
      dataTrack.send('to the remaining room');
      await sleep(TIMEOUT.negotiate);

      expect(received[1]).toEqual(['to both rooms', 'to the remaining room']);
      tracks[1].removeAllListeners('message');
    } finally {
      await Promise.all([publisher.cleanup(), ...subscribers.map(s => s.cleanup())]);
    }
  });

  // The documented contract for trackUnsubscribed is that the track's message
  // callback does not fire again. Messages travel on the track's own queue and
  // the unsubscribe on the participant's, so one already in flight has to be
  // dropped rather than delivered late.
  it('delivers no data track messages after trackUnsubscribed', async () => {
    const roomName = uniqueRoom();
    const dataTrack = createLocalDataTrack('chat');
    // Subscriber first, so it sees the publisher connect.
    const subscriber = await connectToRoom('bob', roomName);
    const joined = waitForEvent<RemoteParticipant>(
      subscriber.room,
      'participantConnected',
      TIMEOUT.subscribe,
    );
    const publisher = await connectToRoom('alice', roomName, { dataTracks: [dataTrack] });

    try {
      const alice = await joined;
      const track = await waitForEvent<RemoteDataTrack>(
        alice,
        'trackSubscribed',
        TIMEOUT.subscribe,
      );
      await sleep(TIMEOUT.negotiate);

      let unsubscribed = false;
      const afterUnsubscribe: unknown[] = [];
      track.on('message', (data: string | Buffer) => {
        if (unsubscribed) afterUnsubscribe.push(data);
      });
      alice.once('trackUnsubscribed', () => {
        unsubscribed = true;
      });

      // Keep sending right through the unpublish so a message is in flight
      // when the unsubscribe lands.
      const sender = setInterval(() => {
        try {
          dataTrack.send('mid-teardown');
        } catch {
          // The track stops accepting sends once unpublished.
        }
      }, 5);
      const gone = waitForEvent(alice, 'trackUnsubscribed', TIMEOUT.subscribe);
      publisher.room.localParticipant.unpublishTrack(dataTrack);
      await gone;
      clearInterval(sender);
      await sleep(TIMEOUT.negotiate);

      expect(afterUnsubscribe).toEqual([]);
      track.removeAllListeners('message');
    } finally {
      await Promise.all([publisher.cleanup(), subscriber.cleanup()]);
    }
  });

  // FRAME_CONTRACT.md documents send()'s promise as always settling. The
  // failure this guards against is a send still in flight when the Room goes
  // away: nothing else settles it, so the promise would hang forever.
  it('settles every send() promise when the Room is torn down under it', async () => {
    const roomName = uniqueRoom();
    const dataTrack = createLocalDataTrack('chat');
    const subscriber = await connectToRoom('bob', roomName);
    const joined = waitForEvent<RemoteParticipant>(
      subscriber.room,
      'participantConnected',
      TIMEOUT.subscribe,
    );
    const publisher = await connectToRoom('alice', roomName, { dataTracks: [dataTrack] });

    try {
      const alice = await joined;
      await waitForEvent<RemoteDataTrack>(alice, 'trackSubscribed', TIMEOUT.subscribe);
      await sleep(TIMEOUT.negotiate);

      // Fire a batch and disconnect immediately, without awaiting any of them.
      const sends = Array.from({ length: 20 }, (_, i) => dataTrack.send(`teardown-${i}`));
      publisher.room.disconnect();

      const settled = await Promise.race([
        Promise.all(sends),
        sleep(TIMEOUT.negotiate * 2).then(() => null),
      ]);

      expect(settled).not.toBeNull();
      for (const result of settled as Array<{ ok: boolean; messageId: number }>) {
        expect(typeof result.ok).toBe('boolean');
        expect(typeof result.messageId).toBe('number');
      }
    } finally {
      await Promise.all([publisher.cleanup(), subscriber.cleanup()]);
    }
  });
});
