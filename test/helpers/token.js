import twilio from 'twilio';
const AccessToken = twilio.jwt.AccessToken;
const VideoGrant = AccessToken.VideoGrant;

const PREFIX = 'TWILIO_STAGE_';

function generateToken(identity, roomName) {
  const accountSid = process.env[`${PREFIX}ACCOUNT_SID`];
  const apiKey = process.env[`${PREFIX}API_KEY`];
  const apiSecret = process.env[`${PREFIX}API_SECRET`];

  if (!accountSid || !apiKey || !apiSecret) {
    const missing = [];
    if (!accountSid) missing.push(`${PREFIX}ACCOUNT_SID`);
    if (!apiKey) missing.push(`${PREFIX}API_KEY`);
    if (!apiSecret) missing.push(`${PREFIX}API_SECRET`);

    throw new Error(
      `Missing required environment variables for integration tests:\n  ${missing.join('\n  ')}\n\n` +
        `Set these variables to run integration tests.`,
    );
  }

  const token = new AccessToken(accountSid, apiKey, apiSecret, {
    identity,
    ttl: 3600,
  });

  const videoGrant = new VideoGrant();
  if (roomName) {
    videoGrant.room = roomName;
  }
  token.addGrant(videoGrant);

  return token.toJwt();
}

export { generateToken };
