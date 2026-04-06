import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { connectToRoom } from './helpers/connect.js';
import { generateI420Frame, generateAudioSamples } from './helpers/media.js';
import type {
  RemoteVideoTrack,
  RemoteAudioTrack,
  RemoteDataTrack,
  RemoteParticipant,
  VideoFrameMetadata,
  AudioFrameMetadata,
  LocalVideoTrackPublication,
  RemoteTrack,
} from '../dist/index.mjs';
import {
  createLocalVideoTrack,
  createLocalAudioTrack,
  createLocalDataTrack,
} from '../dist/index.mjs';
import type { EventEmitter } from 'node:events';

const TRACK_SUBSCRIBE_TIMEOUT = 15_000;
const MEDIA_FLOW_TIMEOUT = 10_000;
// SDP renegotiation after publishTrack + trackSubscribed needs time to complete
// before the encoder sink attaches and frames actually flow
const NEGOTIATION_SETTLE_MS = 3_000;

function uniqueRoom(): string {
  return `test-${crypto.randomUUID()}`;
}

function waitForEvent<T = unknown>(
  emitter: EventEmitter,
  event: string,
  timeout: number,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for '${event}'`)), timeout);
    emitter.on(event, (arg: T) => {
      clearTimeout(timer);
      resolve(arg);
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function connectPair(roomName: string, opts = {}) {
  const connA = await connectToRoom('alice', roomName, opts);

  const aSeesBPromise = waitForEvent<RemoteParticipant>(
    connA.room,
    'participantConnected',
    TRACK_SUBSCRIBE_TIMEOUT,
  );
  const connB = await connectToRoom('bob', roomName, opts);

  let remoteA: RemoteParticipant | undefined = [...connB.room.participants.values()].find(
    (p: RemoteParticipant) => p.identity === 'alice',
  );
  if (!remoteA) {
    remoteA = await waitForEvent<RemoteParticipant>(
      connB.room,
      'participantConnected',
      TRACK_SUBSCRIBE_TIMEOUT,
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
      TRACK_SUBSCRIBE_TIMEOUT,
    );
    connA.room.localParticipant.publishTrack(videoTrack);
    const remoteTrack = await trackPromise;

    // Wait for peer connection renegotiation so encoder sink attaches
    await sleep(NEGOTIATION_SETTLE_MS);

    // Register frame callback, then start pushing
    const receivedFrames: {
      yBuf: Buffer;
      uBuf: Buffer;
      vBuf: Buffer;
      metadata: VideoFrameMetadata;
    }[] = [];
    const framesPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Only received ${receivedFrames.length} frames`));
      }, MEDIA_FLOW_TIMEOUT);

      remoteTrack.onFrame((yBuf, uBuf, vBuf, metadata) => {
        receivedFrames.push({ yBuf, uBuf, vBuf, metadata });
        if (receivedFrames.length >= 3) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    const pushInterval = setInterval(() => {
      const { y, u, v } = generateI420Frame(640, 480);
      videoTrack.pushFrame(y, u, v, 640, 480);
    }, 33);

    await framesPromise;
    clearInterval(pushInterval);

    try {
      expect(receivedFrames.length).toBeGreaterThanOrEqual(3);
      const frame = receivedFrames[0];
      expect(Buffer.isBuffer(frame.yBuf)).toBe(true);
      expect(Buffer.isBuffer(frame.uBuf)).toBe(true);
      expect(Buffer.isBuffer(frame.vBuf)).toBe(true);
      expect(frame.metadata.width).toBeGreaterThan(0);
      expect(frame.metadata.height).toBeGreaterThan(0);
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
      TRACK_SUBSCRIBE_TIMEOUT,
    );
    connA.room.localParticipant.publishTrack(audioTrack);
    const remoteTrack = await trackPromise;

    await sleep(NEGOTIATION_SETTLE_MS);

    const receivedAudio: { samples: Buffer; metadata: AudioFrameMetadata }[] = [];
    const audioPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Only received ${receivedAudio.length} audio callbacks`));
      }, MEDIA_FLOW_TIMEOUT);

      remoteTrack.onData((samples, metadata) => {
        receivedAudio.push({ samples, metadata });
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
      (audioTrack as any).pushSamples(samples, SAMPLE_RATE, CHANNELS);
    }, 10);

    await audioPromise;
    clearInterval(pushInterval);

    try {
      expect(receivedAudio.length).toBeGreaterThanOrEqual(5);
      const frame = receivedAudio[0];
      expect(Buffer.isBuffer(frame.samples)).toBe(true);
      expect(frame.metadata.sampleRate).toBeGreaterThan(0);
      expect(frame.metadata.numberOfChannels).toBeGreaterThan(0);
      expect(frame.metadata.numberOfFrames).toBeGreaterThan(0);
    } finally {
      remoteTrack.removeDataCallback();
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
      }, TRACK_SUBSCRIBE_TIMEOUT);

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

describe('Data track send/receive', () => {
  it('Bob receives string and Buffer messages from Alice', async () => {
    const roomName = uniqueRoom();
    const dataTrack = createLocalDataTrack('chat');

    const { connA, connB, remoteA } = await connectPair(roomName);

    const trackPromise = waitForEvent<RemoteDataTrack>(
      remoteA,
      'trackSubscribed',
      TRACK_SUBSCRIBE_TIMEOUT,
    );
    connA.room.localParticipant.publishTrack(dataTrack);
    const remoteDataTrack = await trackPromise;

    await sleep(NEGOTIATION_SETTLE_MS);

    const received: (string | Buffer)[] = [];
    const messagesPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Only received ${received.length}/2 messages`));
      }, MEDIA_FLOW_TIMEOUT);

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
      TRACK_SUBSCRIBE_TIMEOUT,
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
  it('trackPublished fires after publishTrack with correct trackName', async () => {
    const roomName = uniqueRoom();
    const videoTrack = createLocalVideoTrack('observer-cam');

    const { connA, connB } = await connectPair(roomName);

    const publishedPromise = waitForEvent<{ trackName: string; trackSid: string }>(
      connA.room.localParticipant,
      'trackPublished',
      TRACK_SUBSCRIBE_TIMEOUT,
    );

    connA.room.localParticipant.publishTrack(videoTrack);
    const publication = await publishedPromise;

    try {
      expect(publication.trackName).toBe('observer-cam');
      expect(publication.trackSid).toBeTruthy();
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
      TRACK_SUBSCRIBE_TIMEOUT,
    );
    connA.room.localParticipant.publishTrack(videoTrack);
    const publication = await publishedPromise;

    expect(publication.trackName).toBe('pub-event-cam');
    expect(publication.trackSid).toBeTruthy();

    // Wait for subscription to complete before unpublishing
    await waitForEvent(remoteA, 'trackSubscribed', TRACK_SUBSCRIBE_TIMEOUT);

    const unpublishedPromise = waitForEvent<{ trackName: string }>(
      remoteA,
      'trackUnpublished',
      TRACK_SUBSCRIBE_TIMEOUT,
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

    const trackPromise = waitForEvent(remoteA, 'trackSubscribed', TRACK_SUBSCRIBE_TIMEOUT);
    connA.room.localParticipant.publishTrack(videoTrack);
    await trackPromise;

    try {
      const pubs = connA.room.localParticipant.videoTracks;
      expect(pubs.size).toBeGreaterThanOrEqual(1);
      expect([...pubs.values()].some(p => p.trackName === 'lifecycle-cam')).toBe(true);

      const unsubPromise = waitForEvent(remoteA, 'trackUnsubscribed', TRACK_SUBSCRIBE_TIMEOUT);
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
      enableNetworkQuality: true,
    });

    try {
      const level = await waitForEvent<number>(
        connA.room.localParticipant,
        'networkQualityLevelChanged',
        TRACK_SUBSCRIBE_TIMEOUT,
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
    await sleep(NEGOTIATION_SETTLE_MS);
    const pushInterval = setInterval(() => {
      const samples = generateAudioSamples(480, 48000, 1);
      audioTrack.pushSamples(samples);
    }, 10);

    try {
      const speaker = await waitForEvent<RemoteParticipant>(
        connB.room,
        'dominantSpeakerChanged',
        TRACK_SUBSCRIBE_TIMEOUT,
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
      TRACK_SUBSCRIBE_TIMEOUT,
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
        TRACK_SUBSCRIBE_TIMEOUT,
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
          TRACK_SUBSCRIBE_TIMEOUT,
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
        TRACK_SUBSCRIBE_TIMEOUT,
      );
      connB.room.on('trackSubscribed', (track, participant) => {
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
      expect(remotePub!.track).toBe(track);
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
      TRACK_SUBSCRIBE_TIMEOUT,
    );
    const subscribedPromise = waitForEvent<RemoteVideoTrack>(
      remoteA,
      'trackSubscribed',
      TRACK_SUBSCRIBE_TIMEOUT,
    );

    connA.room.localParticipant.publishTrack(videoTrack);
    const [published, remoteTrack] = await Promise.all([publishedPromise, subscribedPromise]);

    try {
      const pub = remoteA.videoTracks.get(published.trackSid);
      expect(pub).toBeTruthy();
      expect(pub!.kind).toBe('video');
      expect(pub!.isSubscribed).toBe(true);
      expect(pub!.track).toBe(remoteTrack);
      expect(pub!.trackSid).toBe(published.trackSid);
    } finally {
      await Promise.all([connA.cleanup(), connB.cleanup()]);
    }
  });
});
