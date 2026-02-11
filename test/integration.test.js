const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { hasCredentials } = require('./helpers/token');
const { connectToRoom } = require('./helpers/connect');
const { generateI420Frame, generateAudioSamples } = require('./helpers/media');
const { MediaFactory } = require('../lib');


const SKIP = !hasCredentials();
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

describe('Integration: Room connect/disconnect', { skip: SKIP && 'Missing TWILIO_STAGE_* credentials' }, () => {
    it('connects, verifies state, disconnects', { timeout: 45_000 }, async () => {
        const roomName = uniqueRoom();
        const { room, cleanup } = await connectToRoom('alice', roomName);

        try {
            assert.equal(room.state, 'connected');
            assert.equal(room.name, roomName);
            assert.ok(room.sid, 'room should have a sid');
            assert.ok(room.localParticipant, 'should have localParticipant');
            assert.equal(room.localParticipant.identity, 'alice');
        } finally {
            await cleanup();
        }
    });
});

describe('Integration: Participant discovery', { skip: SKIP && 'Missing TWILIO_STAGE_* credentials' }, () => {
    it('both participants see each other', { timeout: 45_000 }, async () => {
        const roomName = uniqueRoom();
        const { connA, connB, remoteB, remoteA } = await connectPair(roomName);

        try {
            assert.equal(remoteB.identity, 'bob');
            assert.ok(remoteA, 'bob should see alice in remoteParticipants');
            assert.equal(remoteA.identity, 'alice');
        } finally {
            await Promise.all([connA.cleanup(), connB.cleanup()]);
        }
    });
});

describe('Integration: Video publish + receive', { skip: SKIP && 'Missing TWILIO_STAGE_* credentials' }, () => {
    it('B receives video frames from A', { timeout: 60_000 }, async () => {
        const roomName = uniqueRoom();
        const mfA = new MediaFactory();
        const videoTrack = mfA.createVideoTrack({ name: 'test-cam' });

        const { connA, connB, remoteB, remoteA } = await connectPair(roomName, { mediaFactory: mfA });

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
            assert.ok(receivedFrames.length >= 3, `Expected >= 3 frames, got ${receivedFrames.length}`);
            const frame = receivedFrames[0];
            assert.ok(Buffer.isBuffer(frame.yBuf), 'Y plane should be a Buffer');
            assert.ok(Buffer.isBuffer(frame.uBuf), 'U plane should be a Buffer');
            assert.ok(Buffer.isBuffer(frame.vBuf), 'V plane should be a Buffer');
            assert.ok(frame.metadata.width > 0, 'width should be > 0');
            assert.ok(frame.metadata.height > 0, 'height should be > 0');
        } finally {
            remoteTrack.removeFrameCallback();
            await Promise.all([connA.cleanup(), connB.cleanup()]);
        }
    });
});

describe('Integration: Audio publish + receive', { skip: SKIP && 'Missing TWILIO_STAGE_* credentials' }, () => {
    it('B receives audio samples from A', { timeout: 60_000 }, async () => {
        const roomName = uniqueRoom();
        const mfA = new MediaFactory();
        const audioTrack = mfA.createAudioTrack({ name: 'test-mic' });

        const { connA, connB, remoteB, remoteA } = await connectPair(roomName, { mediaFactory: mfA });

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
            assert.ok(receivedAudio.length >= 5, `Expected >= 5 audio callbacks, got ${receivedAudio.length}`);
            const frame = receivedAudio[0];
            assert.ok(Buffer.isBuffer(frame.samples), 'samples should be a Buffer');
            assert.ok(frame.metadata.sampleRate > 0, 'sampleRate should be > 0');
            assert.ok(frame.metadata.numberOfChannels > 0, 'numberOfChannels should be > 0');
            assert.ok(frame.metadata.numberOfFrames > 0, 'numberOfFrames should be > 0');
        } finally {
            remoteTrack.removeDataCallback();
            await Promise.all([connA.cleanup(), connB.cleanup()]);
        }
    });
});

describe('Integration: Multiple tracks', { skip: SKIP && 'Missing TWILIO_STAGE_* credentials' }, () => {
    it('B receives both video and audio tracks from A', { timeout: 45_000 }, async () => {
        const roomName = uniqueRoom();
        const mfA = new MediaFactory();
        const videoTrack = mfA.createVideoTrack({ name: 'multi-cam' });
        const audioTrack = mfA.createAudioTrack({ name: 'multi-mic' });

        const { connA, connB, remoteB, remoteA } = await connectPair(roomName, { mediaFactory: mfA });

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
            assert.equal(tracks.length, 2, 'Should receive 2 tracks');
            const names = tracks.map(t => t.name).sort();
            assert.deepEqual(names, ['multi-cam', 'multi-mic']);
        } finally {
            await Promise.all([connA.cleanup(), connB.cleanup()]);
        }
    });
});
