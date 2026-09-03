import type { Room, ConnectOptions } from '../../lib/index.js';
import { connect } from '../../lib/index.js';
import { generateToken } from './token.js';

const CONNECTION_TIMEOUT = 15_000;

type ConnectTrackOptions = Pick<
  ConnectOptions,
  | 'videoTracks'
  | 'audioTracks'
  | 'dataTracks'
  | 'enableDominantSpeaker'
  | 'networkQuality'
  | 'bandwidthProfile'
>;

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
    ...('enableDominantSpeaker' in opts && { enableDominantSpeaker: opts.enableDominantSpeaker }),
    ...('networkQuality' in opts && { networkQuality: opts.networkQuality }),
    ...('bandwidthProfile' in opts && { bandwidthProfile: opts.bandwidthProfile }),
  });

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Connection timeout for ${identity}`)), CONNECTION_TIMEOUT),
  );

  const room = await Promise.race([roomPromise, timeoutPromise]);

  return {
    room,
    cleanup() {
      return new Promise<void>(resolve => {
        const fallback = setTimeout(resolve, 3000);
        room.once('disconnected', () => {
          clearTimeout(fallback);
          resolve();
        });
        room.dispose();
      });
    },
  };
}

export { connectToRoom };
