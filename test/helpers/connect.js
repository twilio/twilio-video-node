import { connect, MediaFactory } from '../../lib/index.js';
import { generateToken } from './token.js';

const CONNECTION_TIMEOUT = 15_000;

async function connectToRoom(identity, roomName, opts = {}) {
  const mediaFactory = opts.mediaFactory || new MediaFactory();
  const token = generateToken(identity, roomName);

  const roomPromise = connect(token, {
    name: roomName,
    mediaFactory,
    videoTracks: opts.videoTracks || [],
    audioTracks: opts.audioTracks || [],
    dataTracks: opts.dataTracks || [],
  });

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Connection timeout for ${identity}`)), CONNECTION_TIMEOUT),
  );

  const room = await Promise.race([roomPromise, timeoutPromise]);

  return {
    room,
    mediaFactory,
    cleanup() {
      return new Promise(resolve => {
        room.on('disconnected', () => resolve());
        room.disconnect();
        setTimeout(resolve, 3000);
      });
    },
  };
}

export { connectToRoom };
