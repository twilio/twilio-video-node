/**
 * Video Mirror — receives remote video and pushes it back as-is.
 *
 * Usage: node examples/video_mirror.js [room-name]
 */

const { connect, createLocalVideoTrack } = require('../dist/index.cjs');
const { generateToken } = require('./helpers/token');

const ROOM_NAME = process.argv[2] || 'mirror-room';

async function main() {
  const videoTrack = createLocalVideoTrack('mirror');

  console.log('Connecting to room:', ROOM_NAME);
  const room = await connect(generateToken('node-participant', ROOM_NAME), {
    name: ROOM_NAME,
    videoTracks: [videoTrack],
    enableAutomaticSubscription: true,
  });
  console.log('Connected! Room:', room.name, 'SID:', room.sid);

  let frameCount = 0;
  const subscribedTracks = [];
  const handledTrackSids = new Set();

  async function handleTrack(track, participant) {
    if (track.kind !== 'video') return;
    if (handledTrackSids.has(track.sid)) return;
    handledTrackSids.add(track.sid);
    subscribedTracks.push(track);
    console.log('Subscribed to video from', participant.identity);

    // Receive and re-publish. The delivered VideoFrame and VideoFrameInput use
    // the same planar shape, so a mirror needs no reshaping at all.
    for await (const frame of track.frames({ mode: 'latest', maxQueue: 1 })) {
      frameCount++;
      videoTrack.write({
        format: 'I420',
        width: frame.width,
        height: frame.height,
        y: frame.y,
        u: frame.u,
        v: frame.v,
        timestamp: frame.timestamp,
        rotation: frame.rotation,
      });
      // Release the planes now rather than waiting for GC.
      frame.close?.();
    }
    console.log('Video stream ended for', participant.identity);
  }

  function handleParticipant(participant) {
    console.log('Participant:', participant.identity);
    participant.on('trackSubscribed', track => {
      handleTrack(track, participant).catch(err => console.error('mirror failed:', err));
    });

    const poll = setInterval(() => {
      for (const pub of participant.videoTracks.values()) {
        if (pub.isSubscribed && pub.track) {
          handleTrack(pub.track, participant).catch(err => console.error('mirror failed:', err));
          clearInterval(poll);
          return;
        }
      }
    }, 100);
    setTimeout(() => clearInterval(poll), 30000);
  }

  room.participants.forEach(handleParticipant);
  room.on('participantConnected', handleParticipant);

  room.on('disconnected', error => {
    console.log('Disconnected', error ? error.message : '');
    process.exit(error ? 1 : 0);
  });

  const shutdown = () => {
    console.log('\nShutting down...');
    room.disconnect();
    setTimeout(() => process.exit(0), 2000);
  };
  process.on('SIGINT', shutdown);

  setInterval(() => {
    console.log(`[tick] state=${room.state} frames=${frameCount}`);
  }, 5000);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
