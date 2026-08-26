const path = require('path');
const envPath = path.join(__dirname, '..', '..', '.env');
try {
  process.loadEnvFile(envPath);
} catch {
  console.error(
    `Error: no .env file found at ${envPath}. Copy .env.example to .env and fill in your Twilio credentials.`,
  );
  process.exit(1);
}

const twilio = require('twilio');

function generateToken(identity, roomName) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const apiKey = process.env.TWILIO_API_KEY;
  const apiSecret = process.env.TWILIO_API_SECRET;
  if (!accountSid || !apiKey || !apiSecret) {
    console.error('Error: TWILIO_ACCOUNT_SID, TWILIO_API_KEY, and TWILIO_API_SECRET are required');
    process.exit(1);
  }
  const token = new twilio.jwt.AccessToken(accountSid, apiKey, apiSecret, { identity, ttl: 3600 });
  token.addGrant(new twilio.jwt.AccessToken.VideoGrant({ room: roomName }));
  return token.toJwt();
}

module.exports = { generateToken };
