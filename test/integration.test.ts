import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import { connectToRoom } from './helpers/connect.js';
import { generateI420Frame, generateAudioSamples } from './helpers/media.js';
import type {
  RemoteVideoTrack,
  RemoteAudioTrack,
  RemoteDataTrack,
  RemoteParticipant,
  VideoFrame,
  AudioFrame,
  RemoteTrack,
  StatsReport,
  VideoContentPreferences,
} from '../dist/index.mjs';
import {
  connect,
  createLocalVideoTrack,
  createLocalAudioTrack,
  createLocalDataTrack,
  LocalVideoTrackPublication,
} from '../dist/index.mjs';
import type { EventEmitter } from 'node:events';

const TIMEOUT = {
  subscribe: 15_000,
  mediaFlow: 10_000,
  // SDP renegotiation after publishTrack + trackSubscribed needs time to complete
  // before the encoder sink attaches and frames actually flow
  negotiate: 3_000,
} as const;

function uniqueRoom(): string {
  return `test-${crypto.randomUUID()}`;
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
    const receivedFrames: VideoFrame[] = [];
    const framesPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Only received ${receivedFrames.length} frames`));
      }, TIMEOUT.mediaFlow);

      remoteTrack.onFrame(frame => {
        receivedFrames.push(frame);
        if (receivedFrames.length >= 3) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    const pushInterval = setInterval(() => {
      const { y, u, v } = generateI420Frame(640, 480);
      videoTrack.write({
        y,
        u,
        v,
        width: 640,
        height: 480,
        yStride: 640,
        uStride: 320,
        vStride: 320,
        timestampNs: process.hrtime.bigint(),
      });
    }, 33);

    await framesPromise;
    clearInterval(pushInterval);

    try {
      expect(receivedFrames.length).toBeGreaterThanOrEqual(3);
      const frame = receivedFrames[0];
      expect(frame.format).toBe('I420');
      expect(Buffer.isBuffer(frame.y.data)).toBe(true);
      expect(Buffer.isBuffer(frame.u.data)).toBe(true);
      expect(Buffer.isBuffer(frame.v.data)).toBe(true);
      expect(frame.width).toBeGreaterThan(0);
      expect(frame.height).toBeGreaterThan(0);
      expect(typeof frame.timestampNs).toBe('bigint');
    } finally {
      remoteTrack.removeFrameCallback();
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

    const receivedAudio: AudioFrame[] = [];
    const audioPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Only received ${receivedAudio.length} audio callbacks`));
      }, TIMEOUT.mediaFlow);

      remoteTrack.onFrame(frame => {
        receivedAudio.push(frame);
        if (receivedAudio.length >= 5) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    const SAMPLE_RATE = 48000;
    const CHANNELS = 1;
    const FRAME_SIZE = 480;

    const pushInterval = setInterval(() => {
      const samples = generateAudioSamples(FRAME_SIZE, SAMPLE_RATE, CHANNELS);
      audioTrack.write({
        pcm: samples,
        frames: FRAME_SIZE,
      });
    }, 10);

    await audioPromise;
    clearInterval(pushInterval);

    try {
      expect(receivedAudio.length).toBeGreaterThanOrEqual(5);
      const frame = receivedAudio[0];
      expect(frame.format).toBe('PCM_S16LE');
      expect(Buffer.isBuffer(frame.pcm)).toBe(true);
      expect(frame.sampleRate).toBe(48000);
      expect(frame.channels).toBe(1);
      expect(frame.frames).toBeGreaterThan(0);
      expect(typeof frame.timestampNs).toBe('bigint');
    } finally {
      remoteTrack.removeFrameCallback();
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

      remoteDataTrack.onMessage((data: string | Buffer) => {
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
      remoteDataTrack.removeMessageCallback();
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

    const publishedPromise = waitForEvent<{ trackName: string; trackSid: string }>(
      remoteA,
      'trackPublished',
      TIMEOUT.subscribe,
    );
    const subscribedPromise = waitForEvent(remoteA, 'trackSubscribed', TIMEOUT.subscribe);

    connA.room.localParticipant.publishTrack(videoTrack);
    const publication = await publishedPromise;

    expect(publication.trackName).toBe('pub-event-cam');
    expect(publication.trackSid).toBeTruthy();

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
      connB.room.on('trackSubscribed', (track: RemoteTrack, _publication, participant: RemoteParticipant) => {
        kinds.push(track.kind);
        publishers.push(participant.identity);
        if (kinds.length === 2) {
          clearTimeout(timeout);
          resolve();
        }
      });
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
      await disabled;
      videoTrack.enabled = true;
      await enabled;
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
      const { y, u, v } = generateI420Frame(640, 480);
      videoTrack.write({
        y,
        u,
        v,
        width: 640,
        height: 480,
        yStride: 640,
        uStride: 320,
        vStride: 320,
        timestampNs: process.hrtime.bigint(),
      });
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
      const { y, u, v } = generateI420Frame(640, 480);
      videoTrack.write({
        y,
        u,
        v,
        width: 640,
        height: 480,
        yStride: 640,
        uStride: 320,
        vStride: 320,
        timestampNs: process.hrtime.bigint(),
      });
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
      const unsubscribed = waitForEvents<RemoteTrack>(bob, 'trackUnsubscribed', 2, TIMEOUT.subscribe);

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

      const subscribedAfterRead = waitForEvent<RemoteTrack>(bob, 'trackSubscribed', TIMEOUT.subscribe);
      peer.room.localParticipant.publishTrack(createLocalAudioTrack('audio'));
      const track = await subscribedAfterRead;
      expect(track.kind).toBe('audio');

      await peer.cleanup();
    } finally {
      await incumbent.cleanup();
    }
  });
});
