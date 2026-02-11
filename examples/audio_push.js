/**
 * Pushable Audio Example - sends a sine wave tone to a room
 *
 * Usage:
 *   TWILIO_ACCESS_TOKEN=xxx node examples/audio_push.js [room-name]
 */

const { connect, MediaFactory } = require('../lib');

const ROOM_NAME = process.argv[2] || 'cpp-room';
const TOKEN = process.env.TWILIO_ACCESS_TOKEN;

if (!TOKEN) {
    console.error('Error: TWILIO_ACCESS_TOKEN environment variable is required');
    process.exit(1);
}

const SAMPLE_RATE = 48000;
const CHANNELS = 1;
const FRAME_DURATION_MS = 10;
const SAMPLES_PER_FRAME = (SAMPLE_RATE * FRAME_DURATION_MS) / 1000; // 480
const TONE_HZ = 440;
const AMPLITUDE = 3000;

function generateSineFrame(frameIndex) {
    const buf = Buffer.alloc(SAMPLES_PER_FRAME * CHANNELS * 2); // 2 bytes per int16
    const startSample = frameIndex * SAMPLES_PER_FRAME;

    for (let i = 0; i < SAMPLES_PER_FRAME; i++) {
        const t = (startSample + i) / SAMPLE_RATE;
        const sample = Math.round(AMPLITUDE * Math.sin(2 * Math.PI * TONE_HZ * t));
        buf.writeInt16LE(sample, i * 2);
    }

    return buf;
}

async function main() {
    console.log('Connecting to room:', ROOM_NAME);

    const mediaFactory = new MediaFactory();
    const audioTrack = mediaFactory.createAudioTrack({ name: 'pushable-audio' });
    console.log('Created audio track:', audioTrack.name);

    const room = await connect({
        token: TOKEN,
        roomName: ROOM_NAME,
        mediaFactory: mediaFactory,
        audioTracks: [audioTrack],
    });

    console.log('Connected! Room:', room.name, 'SID:', room.sid);
    startPushingAudio(audioTrack);

    room.on('disconnected', (error) => {
        console.log('Disconnected', error ? error.message : '');
        process.exit(0);
    });

    // Subscribe to remote audio via participant events
    function handleParticipant(participant) {
        console.log('Participant connected:', participant.identity);
        let remoteFrames = 0;
        participant.on('trackSubscribed', (track) => {
            if (track.onData) {
                console.log('Subscribed to remote audio from', participant.identity);
                track.onData((samples, metadata) => {
                    remoteFrames++;
                    if (remoteFrames % 100 === 0) {
                        console.log(`Remote audio: ${remoteFrames} callbacks, ${metadata.sampleRate}Hz ${metadata.numberOfChannels}ch ${metadata.numberOfFrames} frames`);
                    }
                });
            }
        });
    }

    room.remoteParticipants.forEach(handleParticipant);
    room.on('participantConnected', handleParticipant);

    setInterval(() => {
        console.log('[tick] state:', room.state);
    }, 5000);

    process.on('SIGINT', () => {
        room.disconnect();
        setTimeout(() => process.exit(0), 1000);
    });
}

function startPushingAudio(audioTrack) {
    let frameIndex = 0;

    setInterval(() => {
        const samples = generateSineFrame(frameIndex);
        audioTrack.pushSamples(samples, SAMPLE_RATE, CHANNELS);
        frameIndex++;
        if (frameIndex % 100 === 0) {
            console.log('Pushed', frameIndex, 'audio frames');
        }
    }, FRAME_DURATION_MS);
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
