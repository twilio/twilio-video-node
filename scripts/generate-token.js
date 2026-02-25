#!/usr/bin/env node

const AccessToken = require('twilio').jwt.AccessToken;
const VideoGrant = AccessToken.VideoGrant;

// Check for environment flag (stage uses TWILIO_STAGE_* vars)
const envArg = process.argv.find(a => a === 'stage' || a === '--stage');
const prefix = envArg ? 'TWILIO_STAGE_' : 'TWILIO_';

const accountSid = process.env[`${prefix}ACCOUNT_SID`];
const apiKey = process.env[`${prefix}API_KEY`];
const apiSecret = process.env[`${prefix}API_SECRET`];

if (!accountSid || !apiKey || !apiSecret) {
  const vars = [`${prefix}ACCOUNT_SID`, `${prefix}API_KEY`, `${prefix}API_SECRET`];
  console.error(`Missing environment variables for ${envArg ? 'stage' : 'production'}:`);
  vars.filter(v => !process.env[v]).forEach(v => console.error(`  - ${v}`));
  process.exit(1);
}

const args = process.argv.slice(2).filter(a => a !== 'stage' && a !== '--stage');
const identity = args[0] || 'node-bot';
const roomName = args[1] || undefined;

const token = new AccessToken(accountSid, apiKey, apiSecret, { identity, ttl: 3600 });

const videoGrant = new VideoGrant();
if (roomName) {
  videoGrant.room = roomName;
}
token.addGrant(videoGrant);

const jwt = token.toJwt();

console.log(`\n✓ Generated Access Token (${envArg ? 'stage' : 'production'})`);
console.log('  Identity:', identity);
if (roomName) {
  console.log('  Room:', roomName);
}
console.log('  TTL: 1 hour');
console.log('\nToken:\n');
console.log(jwt);
console.log('\n\nTo use:');
console.log(`  export TWILIO_ACCESS_TOKEN="${jwt}"`);
console.log(`  arch -x86_64 node examples/virtual_camera.js test-room`);
console.log('');
