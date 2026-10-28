// Fake dist/index.mjs for soak.test.mjs: the first Room drops, and local tracks
// hold the event loop open like live native tracks.
import { EventEmitter } from 'node:events';

// Answer the room pre-create locally.
globalThis.fetch = async () => ({
  ok: true,
  json: async () => ({ sid: 'RMfake', max_participant_duration: 600 }),
  text: async () => '',
});

function fakeTrack() {
  setInterval(() => {}, 1_000);
  return { write() {}, getWriteStats: () => ({ framesWritten: 0, framesDropped: 0 }) };
}

export const createLocalVideoTrack = fakeTrack;
export const createLocalAudioTrack = fakeTrack;

let rooms = 0;
export async function connect() {
  const room = new EventEmitter();
  room.sid = 'RMfake';
  room.participants = new Map();
  room.disconnect = () => {};
  room.dispose = () => {};
  if (rooms++ === 0) {
    setTimeout(() => {
      room.emit('disconnected', room, { code: 53000, message: 'fake signaling failure' });
    }, 50);
  }
  return room;
}
