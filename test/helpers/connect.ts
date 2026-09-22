import type { Room, ConnectOptions } from '../../lib/index.js';
import { connect } from '../../lib/index.js';
import { generateToken } from './token.js';

const CONNECTION_TIMEOUT = 15_000;

// Recorded so a subscribe timeout can report its cause. Two different faults
// both look like zero trackSubscribed events: a listener attached after the
// subscription already completed, and a media connection that failed
// (MediaConnectionError, 53405). Publications reporting isSubscribed with no
// failure event mean the event was missed; a failure code with nothing
// subscribed means the media connection failed.
interface RoomDiag {
  identity: string;
  room: Room;
  connectedAt: number;
  log: string[];
}

const liveRooms = new Set<RoomDiag>();

function describeError(error: unknown): string {
  if (!error) return 'no error';
  const e = error as { name?: string; code?: number; message?: string };
  return `${e.name}(${e.code}): ${e.message}`;
}

function watchRoom(identity: string, room: Room): RoomDiag {
  const diag: RoomDiag = { identity, room, connectedAt: Date.now(), log: [] };
  const record = (line: string) => diag.log.push(`+${Date.now() - diag.connectedAt}ms ${line}`);
  room.on('disconnected', (_room, error) => record(`disconnected ${describeError(error)}`));
  room.on('reconnecting', error => record(`reconnecting ${describeError(error)}`));
  room.on('reconnected', () => record('reconnected'));
  room.on('connectFailure', error => record(`connectFailure ${describeError(error)}`));
  room.on('trackSubscriptionFailed', (error, publication, participant) =>
    record(
      `trackSubscriptionFailed ${participant.identity}/${publication.trackName} ${describeError(error)}`,
    ),
  );
  room.on('trackSubscribed', (track, _publication, participant) =>
    record(`trackSubscribed ${participant.identity}/${track.kind}/${track.name}`),
  );
  room.on('participantConnected', p => record(`participantConnected ${p.identity}`));
  room.on('participantDisconnected', p => record(`participantDisconnected ${p.identity}`));
  liveRooms.add(diag);
  return diag;
}

/**
 * Snapshot every Room not yet cleaned up: its recorded lifecycle and failure
 * events, and each remote publication's current `isSubscribed` state. Appended
 * to subscribe-timeout errors so a failure reports which mechanism produced it.
 */
function describeLiveRooms(): string {
  const now = Date.now();
  const lines = ['--- live rooms at timeout ---'];
  for (const { identity, room, connectedAt, log } of liveRooms) {
    lines.push(
      `[${identity}] ${room.sid} state=${room.state} connected=${new Date(connectedAt).toISOString()} age=${now - connectedAt}ms`,
    );
    for (const participant of room.participants.values()) {
      const pubs = [...participant.tracks.values()].map(
        p => `${p.kind}/${p.trackName} isSubscribed=${p.isSubscribed}`,
      );
      lines.push(
        `  remote ${participant.identity} state=${participant.state}: ${pubs.join(', ') || 'no publications'}`,
      );
    }
    lines.push(...log.map(line => `  ${line}`));
    if (log.length === 0) lines.push('  (no events recorded)');
  }
  return lines.join('\n');
}

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
  const diag = watchRoom(identity, room);

  return {
    room,
    cleanup() {
      liveRooms.delete(diag);
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

export { connectToRoom, describeLiveRooms };
