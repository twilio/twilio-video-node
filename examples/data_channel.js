/**
 * Data Channel Example - two participants exchange string and binary messages
 *
 * Usage:
 *   Terminal 1: TWILIO_ACCESS_TOKEN=<alice-token> node examples/data_channel.js my-room alice
 *   Terminal 2: TWILIO_ACCESS_TOKEN=<bob-token>   node examples/data_channel.js my-room bob
 */

const { connect, LocalDataTrack } = require('../lib');

const ROOM_NAME = process.argv[2] || 'data-room';
const IDENTITY = process.argv[3] || 'alice';
const TOKEN = process.env.TWILIO_ACCESS_TOKEN;

if (!TOKEN) {
  console.error('Error: TWILIO_ACCESS_TOKEN environment variable is required');
  process.exit(1);
}

async function main() {
  const dataTrack = new LocalDataTrack(`${IDENTITY}-chat`);

  console.log(`[${IDENTITY}] Connecting to room: ${ROOM_NAME}`);

  const room = await connect(TOKEN, {
    name: ROOM_NAME,
    dataTracks: [dataTrack],
  });

  console.log(`[${IDENTITY}] Connected! Room SID: ${room.sid}`);

  // Handle remote participants already in the room
  for (const participant of room.remoteParticipants) {
    handleRemoteParticipant(participant);
  }

  room.on('participantConnected', participant => {
    console.log(`[${IDENTITY}] Participant joined: ${participant.identity}`);
    handleRemoteParticipant(participant);
  });

  room.on('participantDisconnected', participant => {
    console.log(`[${IDENTITY}] Participant left: ${participant.identity}`);
  });

  room.on('disconnected', error => {
    console.log(`[${IDENTITY}] Disconnected`, error ? error.message : '');
    process.exit(0);
  });

  // Send messages periodically
  let msgCount = 0;
  setInterval(() => {
    msgCount++;
    if (msgCount % 2 === 1) {
      const text = `Hello from ${IDENTITY} (#${msgCount})`;
      dataTrack.send(text);
      console.log(`[${IDENTITY}] Sent string: ${text}`);
    } else {
      const buf = Buffer.from([0x01, msgCount & 0xff, 0x03, 0x04]);
      dataTrack.send(buf);
      console.log(`[${IDENTITY}] Sent binary: ${buf.toString('hex')}`);
    }
  }, 3000);

  process.on('SIGINT', () => {
    room.disconnect();
    setTimeout(() => process.exit(0), 1000);
  });
}

function handleRemoteParticipant(participant) {
  participant.on('trackSubscribed', track => {
    if (typeof track.onMessage === 'function') {
      console.log(`[${IDENTITY}] Subscribed to data track: ${track.name}`);
      track.onMessage(data => {
        if (typeof data === 'string') {
          console.log(`[${IDENTITY}] Received string from ${participant.identity}: ${data}`);
        } else {
          console.log(
            `[${IDENTITY}] Received binary from ${participant.identity}: ${data.toString('hex')}`,
          );
        }
      });
    }
  });
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
