/**
 * Pushable Audio Example - sends a sine wave tone to a room
 *
 * Usage: node examples/audio_push.js [room-name]
 */

const { connect, createLocalAudioTrack } = require('../dist/index.cjs');
const { generateToken } = require('./helpers/token');
const { createPacedWriter } = require('./helpers/paced-audio-writer');

const ROOM_NAME = process.argv[2] || 'cpp-room';

const SAMPLE_RATE = 48000;
const FRAME_DURATION_MS = 10;
const SAMPLES_PER_FRAME = (SAMPLE_RATE * FRAME_DURATION_MS) / 1000; // 480
const TONE_HZ = 440;
const AMPLITUDE = 3000;

function generateSineFrame(frameIndex) {
  const buf = Buffer.alloc(SAMPLES_PER_FRAME * 2); // 2 bytes per int16
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

  const audioTrack = createLocalAudioTrack('pushable-audio');
  console.log('Created audio track:', audioTrack.name);

  const room = await connect(generateToken('node-participant', ROOM_NAME), {
    name: ROOM_NAME,
    audioTracks: [audioTrack],
  });

  console.log('Connected! Room:', room.name, 'SID:', room.sid);
  const pusher = startPushingAudio(audioTrack);

  room.on('disconnected', error => {
    pusher.stop();
    console.log('Disconnected', error ? error.message : '');
    process.exit(0);
  });

  // Subscribe to remote audio via participant events
  function handleParticipant(participant) {
    console.log('Participant connected:', participant.identity);
    let remoteFrames = 0;
    participant.on('trackSubscribed', track => {
      if (track.onFrame && track.kind === 'audio') {
        console.log('Subscribed to remote audio from', participant.identity);
        track.onFrame(frame => {
          remoteFrames++;
          if (remoteFrames % 100 === 0) {
            console.log(
              `Remote audio: ${remoteFrames} callbacks, ${frame.sampleRate}Hz ${frame.channels}ch ${frame.frames} frames`,
            );
          }
        });
      }
    });
  }

  room.participants.forEach(handleParticipant);
  room.on('participantConnected', handleParticipant);

  setInterval(() => {
    console.log('[tick] state:', room.state);
  }, 5000);

  process.on('SIGINT', () => {
    pusher.stop();
    room.disconnect();
    setTimeout(() => process.exit(0), 1000);
  });
}

// Generate the tone into a drift-compensated paced writer, which drains it to
// the track at exactly 48 kHz. The writer handles playout timing; this loop
// only has to keep the queue topped up ahead of it. (Writing frames directly on
// a setInterval instead drifts and clicks — see helpers/paced-audio-writer.js.)
function startPushingAudio(audioTrack) {
  const writer = createPacedWriter(audioTrack);
  writer.start();

  let frameIndex = 0;
  const TARGET_QUEUED_BYTES = 6 * SAMPLES_PER_FRAME * 2; // keep ~60 ms queued ahead

  const filler = setInterval(() => {
    while (writer.pendingBytes() < TARGET_QUEUED_BYTES) {
      writer.enqueue(generateSineFrame(frameIndex));
      frameIndex++;
      if (frameIndex % 100 === 0) console.log('Generated', frameIndex, 'audio frames');
    }
  }, FRAME_DURATION_MS);

  return {
    stop() {
      clearInterval(filler);
      writer.stop();
    },
  };
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
