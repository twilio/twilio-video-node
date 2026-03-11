import type { Room, ConnectOptions } from '../../dist/index.mjs';
import { connect } from '../../dist/index.mjs';
import { generateToken } from './token.js';

const CONNECTION_TIMEOUT = 15_000;

type ConnectTrackOptions = Pick<ConnectOptions, 'videoTracks' | 'audioTracks' | 'dataTracks'>;

async function connectToRoom(
  identity: string,
  roomName: string,
  opts: ConnectTrackOptions = {},
): Promise<{ room: Room; cleanup: () => Promise<void> }> {
  const token = generateToken(identity, roomName);

  const roomPromise = connect(token, {
    name: roomName,
    videoTracks: opts.videoTracks || [],
    audioTracks: opts.audioTracks || [],
    dataTracks: opts.dataTracks || [],
  });

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Connection timeout for ${identity}`)), CONNECTION_TIMEOUT),
  );

  const room = await Promise.race([roomPromise, timeoutPromise]);

  return {
    room,
    cleanup() {
      return new Promise<void>(resolve => {
        room.on('disconnected', () => resolve());
        room.disconnect();
        setTimeout(resolve, 3000);
      });
    },
  };
}

export { connectToRoom };
