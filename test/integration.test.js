import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { connectToRoom } from './helpers/connect.js';
import { generateI420Frame, generateAudioSamples } from './helpers/media.js';
import { MediaFactory } from '../lib/index.js';
const TRACK_SUBSCRIBE_TIMEOUT = 15_000;
const MEDIA_FLOW_TIMEOUT = 10_000;
// SDP renegotiation after publishTrack + trackSubscribed needs time to complete
// before the encoder sink attaches and frames actually flow
const NEGOTIATION_SETTLE_MS = 3_000;

function uniqueRoom() {
    return `test-${crypto.randomUUID()}`;
}

function waitForEvent(emitter, event, timeout) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timeout waiting for '${event}'`)), timeout);
        emitter.on(event, (arg) => {
            clearTimeout(timer);
            resolve(arg);
        });
    });
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function connectPair(roomName, optsA = {}) {
    const connA = await connectToRoom('alice', roomName, optsA);

    const aSeesBPromise = waitForEvent(connA.room, 'participantConnected', TRACK_SUBSCRIBE_TIMEOUT);
    const connB = await connectToRoom('bob', roomName);

    let remoteA = connB.room.remoteParticipants.find(p => p.identity === 'alice');
    if (!remoteA) {
        remoteA = await waitForEvent(connB.room, 'participantConnected', TRACK_SUBSCRIBE_TIMEOUT);
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
        const mfA = new MediaFactory();
        const videoTrack = mfA.createVideoTrack({ name: 'test-cam' });

        const { connA, connB, remoteA } = await connectPair(roomName, { mediaFactory: mfA });

        const trackPromise = waitForEvent(remoteA, 'trackSubscribed', TRACK_SUBSCRIBE_TIMEOUT);
        connA.room.localParticipant.publishTrack(videoTrack);
        const remoteTrack = await trackPromise;

        // Wait for peer connection renegotiation so encoder sink attaches
        await sleep(NEGOTIATION_SETTLE_MS);

        // Register frame callback, then start pushing
        const receivedFrames = [];
        const framesPromise = new Promise((resolve, reject) => {
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
        const mfA = new MediaFactory();
        const audioTrack = mfA.createAudioTrack({ name: 'test-mic' });

        const { connA, connB, remoteA } = await connectPair(roomName, { mediaFactory: mfA });

        const trackPromise = waitForEvent(remoteA, 'trackSubscribed', TRACK_SUBSCRIBE_TIMEOUT);
        connA.room.localParticipant.publishTrack(audioTrack);
        const remoteTrack = await trackPromise;

        await sleep(NEGOTIATION_SETTLE_MS);

        const receivedAudio = [];
        const audioPromise = new Promise((resolve, reject) => {
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
            audioTrack.pushSamples(samples, SAMPLE_RATE, CHANNELS);
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
        const mfA = new MediaFactory();
        const videoTrack = mfA.createVideoTrack({ name: 'multi-cam' });
        const audioTrack = mfA.createAudioTrack({ name: 'multi-mic' });

        const { connA, connB, remoteA } = await connectPair(roomName, { mediaFactory: mfA });

        const tracks = [];
        const tracksPromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error(`Only received ${tracks.length}/2 trackSubscribed events`));
            }, TRACK_SUBSCRIBE_TIMEOUT);

            remoteA.on('trackSubscribed', (track) => {
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
        const mfA = new MediaFactory();
        const dataTrack = mfA.createDataTrack({ name: 'chat' });

        const { connA, connB, remoteA } = await connectPair(roomName, { mediaFactory: mfA });

        const trackPromise = waitForEvent(remoteA, 'trackSubscribed', TRACK_SUBSCRIBE_TIMEOUT);
        connA.room.localParticipant.publishTrack(dataTrack);
        const remoteDataTrack = await trackPromise;

        await sleep(NEGOTIATION_SETTLE_MS);

        const received = [];
        const messagesPromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error(`Only received ${received.length}/2 messages`));
            }, MEDIA_FLOW_TIMEOUT);

            remoteDataTrack.onMessage((data) => {
                received.push(data);
                if (received.length >= 2) {
                    clearTimeout(timeout);
                    resolve();
                }
            });
        });

        dataTrack.send('hello');
        dataTrack.send(Buffer.from([0xDE, 0xAD]));

        await messagesPromise;

        try {
            expect(received.length).toBe(2);
            expect(received[0]).toBe('hello');
            expect(Buffer.isBuffer(received[1])).toBe(true);
            expect(received[1][0]).toBe(0xDE);
            expect(received[1][1]).toBe(0xAD);
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

        const disconnectPromise = waitForEvent(connA.room, 'participantDisconnected', TRACK_SUBSCRIBE_TIMEOUT);
        connB.room.disconnect();
        const participant = await disconnectPromise;

        try {
            expect(participant.identity).toBe('bob');
        } finally {
            await connA.cleanup();
        }
    });
});

describe('Track publish/unpublish lifecycle', () => {
    it('published track appears in localParticipant.videoTracks, disappears after unpublish', async () => {
        const roomName = uniqueRoom();
        const mfA = new MediaFactory();
        const videoTrack = mfA.createVideoTrack({ name: 'lifecycle-cam' });

        const { connA, connB, remoteA } = await connectPair(roomName, { mediaFactory: mfA });

        const trackPromise = waitForEvent(remoteA, 'trackSubscribed', TRACK_SUBSCRIBE_TIMEOUT);
        connA.room.localParticipant.publishTrack(videoTrack);
        await trackPromise;

        try {
            const pubs = connA.room.localParticipant.videoTracks;
            expect(pubs.length).toBeGreaterThanOrEqual(1);
            expect(pubs.some(p => p.trackName === 'lifecycle-cam')).toBe(true);

            connA.room.localParticipant.unpublishTrack(videoTrack);
            await sleep(1000);

            const pubsAfter = connA.room.localParticipant.videoTracks;
            expect(pubsAfter.some(p => p.trackName === 'lifecycle-cam')).toBe(false);
        } finally {
            await Promise.all([connA.cleanup(), connB.cleanup()]);
        }
    });
});
