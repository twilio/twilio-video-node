import crypto from 'node:crypto';
import twilio from 'twilio';
import { credentials } from './token.js';

type RoomVideoCodec = 'VP8' | 'H264';

/**
 * Create a Group Room through the REST API, for tests that need room settings
 * an ad-hoc room can't carry. Connect to it by `name`, and register `complete`
 * with `onTestFinished` (or call it in `afterAll`). The room closes itself one
 * minute after its last participant leaves, or one minute after creation if
 * nobody joins.
 */
async function createGroupRoom(settings: { videoCodecs: RoomVideoCodec[] }) {
  const { accountSid, apiKey, apiSecret } = credentials();
  const client = twilio(apiKey, apiSecret, { accountSid });
  const room = await client.video.v1.rooms.create({
    uniqueName: `test-${crypto.randomUUID()}`,
    type: 'group',
    videoCodecs: settings.videoCodecs,
    emptyRoomTimeout: 1,
    unusedRoomTimeout: 1,
  });
  return {
    name: room.uniqueName,
    sid: room.sid,
    videoCodecs: room.videoCodecs,
    async complete(): Promise<void> {
      // Called from cleanup: a throw here would hide the test's own failure.
      await client.video.v1
        .rooms(room.sid)
        .update({ status: 'completed' })
        .catch(e => console.warn(`Could not complete room ${room.sid}: ${e.message}`));
    },
  };
}

export { createGroupRoom };
