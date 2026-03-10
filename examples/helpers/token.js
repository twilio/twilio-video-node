const twilio = require('twilio');

function generateToken(identity, roomName) {
  const accountSid = process.env.TWILIO_STAGE_ACCOUNT_SID;
  const apiKey = process.env.TWILIO_STAGE_API_KEY;
  const apiSecret = process.env.TWILIO_STAGE_API_SECRET;
  if (!accountSid || !apiKey || !apiSecret) {
    console.error(
      'Error: TWILIO_STAGE_ACCOUNT_SID, TWILIO_STAGE_API_KEY, and TWILIO_STAGE_API_SECRET are required',
    );
    process.exit(1);
  }
  const token = new twilio.jwt.AccessToken(accountSid, apiKey, apiSecret, { identity, ttl: 3600 });
  token.addGrant(new twilio.jwt.AccessToken.VideoGrant({ room: roomName }));
  return token.toJwt();
}

module.exports = { generateToken };
