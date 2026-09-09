import twilio from 'twilio';
const AccessToken = twilio.jwt.AccessToken;
const VideoGrant = AccessToken.VideoGrant;

const PREFIX = 'TWILIO_';

function generateToken(identity: string, roomName?: string): string {
  const accountSid = process.env[`${PREFIX}ACCOUNT_SID`];
  const apiKey = process.env[`${PREFIX}API_KEY`];
  const apiSecret = process.env[`${PREFIX}API_SECRET`];

  if (!accountSid || !apiKey || !apiSecret) {
    const missing: string[] = [];
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

/** Credentials, or a clear failure if the environment is not set up. */
function credentials(): { accountSid: string; apiKey: string; apiSecret: string } {
  const accountSid = process.env[`${PREFIX}ACCOUNT_SID`];
  const apiKey = process.env[`${PREFIX}API_KEY`];
  const apiSecret = process.env[`${PREFIX}API_SECRET`];
  if (!accountSid || !apiKey || !apiSecret) {
    throw new Error('Missing Twilio credentials for integration tests');
  }
  return { accountSid, apiKey, apiSecret };
}

/**
 * Tokens that are deliberately wrong, so tests can provoke the real server-side
 * rejection rather than assert against a hand-built error object.
 */
const badTokens = {
  /** Not a JWT at all. */
  malformed(): string {
    return 'this-is-not-a-jwt';
  },

  /**
   * Structurally valid and correctly signed, but already expired. `ttl` is
   * seconds, and the helper accepts a negative value, so the token is minted
   * with an `exp` in the past.
   */
  expired(identity = 'expired-user', roomName?: string): string {
    const { accountSid, apiKey, apiSecret } = credentials();
    const token = new AccessToken(accountSid, apiKey, apiSecret, { identity, ttl: -3600 });
    const grant = new VideoGrant();
    if (roomName) grant.room = roomName;
    token.addGrant(grant);
    return token.toJwt();
  },

  /** Valid and unexpired, but carries no Video grant. */
  noVideoGrant(identity = 'no-grant-user'): string {
    const { accountSid, apiKey, apiSecret } = credentials();
    return new AccessToken(accountSid, apiKey, apiSecret, { identity, ttl: 600 }).toJwt();
  },

  /** A valid token whose signature has been altered, so verification fails. */
  badSignature(identity = 'tampered-user', roomName?: string): string {
    const jwt = generateToken(identity, roomName);
    const [header, payload, signature] = jwt.split('.');
    // Flip one character of the signature, keeping the base64url alphabet.
    const flipped = (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);
    return `${header}.${payload}.${flipped}`;
  },
};

export { generateToken, badTokens };
