/**
 * Video Mirror — receives remote video and pushes it back as-is.
 *
 * Usage:
 *   TWILIO_ACCESS_TOKEN=xxx node examples/video_mirror.js [room-name]
 */

const { connect, createLocalVideoTrack } = require('../lib');

const ROOM_NAME = process.argv[2] || 'mirror-room';
const TOKEN = process.env.TWILIO_ACCESS_TOKEN;

if (!TOKEN) {
  console.error('Error: TWILIO_ACCESS_TOKEN environment variable is required');
  process.exit(1);
}

async function main() {
  const videoTrack = createLocalVideoTrack('mirror');

  console.log('Connecting to room:', ROOM_NAME);
  const room = await connect(TOKEN, {
    name: ROOM_NAME,
    videoTracks: [videoTrack],
    enableAutomaticSubscription: true,
  });
  console.log('Connected! Room:', room.name, 'SID:', room.sid);

  let frameCount = 0;
  const subscribedTracks = [];
  const handledTrackSids = new Set();

  function handleTrack(track, participant) {
    if (!track.onFrame) return;
    if (handledTrackSids.has(track.sid)) return;
    handledTrackSids.add(track.sid);
    subscribedTracks.push(track);
    console.log('Subscribed to video from', participant.identity);

    track.onFrame((yBuf, uBuf, vBuf, meta) => {
      frameCount++;
      videoTrack.pushFrame(yBuf, uBuf, vBuf, meta.width, meta.height);
    });
  }

  function handleParticipant(participant) {
    console.log('Participant:', participant.identity);
    participant.on('trackSubscribed', track => handleTrack(track, participant));

    const poll = setInterval(() => {
      for (const pub of participant.videoTracks) {
        if (pub.isSubscribed && pub.track) {
          handleTrack(pub.track, participant);
          clearInterval(poll);
          return;
        }
      }
    }, 100);
    setTimeout(() => clearInterval(poll), 30000);
  }

  room.remoteParticipants.forEach(handleParticipant);
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
