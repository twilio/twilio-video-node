import twilio from 'twilio';
import { callVendor, usingVendor } from './vendor.js';
const AccessToken = twilio.jwt.AccessToken;
const VideoGrant = AccessToken.VideoGrant;

const PREFIX = 'TWILIO_';

/** An Access Token minted by the vendor. `grant` is `'video'` or `null` (no grant). */
async function vendToken(params: {
  identity: string;
  grant: 'video' | null;
  room?: string;
  ttl: number;
}): Promise<string> {
  const { token } = await callVendor('mint-token', params);
  if (typeof token !== 'string') {
    throw new Error('Vendor action mint-token returned no token');
  }
  return token;
}

/** A Video Access Token: from the vendor if `VENDOR_URL` is set, else signed with `TWILIO_*`. */
async function generateToken(identity: string, roomName?: string): Promise<string> {
  if (usingVendor()) {
    return vendToken({ identity, grant: 'video', room: roomName, ttl: 3600 });
  }
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
  async expired(identity = 'expired-user', roomName?: string): Promise<string> {
    if (usingVendor()) {
      return vendToken({ identity, grant: 'video', room: roomName, ttl: -3600 });
    }
    const { accountSid, apiKey, apiSecret } = credentials();
    const token = new AccessToken(accountSid, apiKey, apiSecret, { identity, ttl: -3600 });
    const grant = new VideoGrant();
    if (roomName) grant.room = roomName;
    token.addGrant(grant);
    return token.toJwt();
  },

  /** Valid and unexpired, but carries no Video grant. */
  async noVideoGrant(identity = 'no-grant-user'): Promise<string> {
    if (usingVendor()) {
      return vendToken({ identity, grant: null, ttl: 600 });
    }
    const { accountSid, apiKey, apiSecret } = credentials();
    return new AccessToken(accountSid, apiKey, apiSecret, { identity, ttl: 600 }).toJwt();
  },

  /** A valid token whose signature has been altered, so verification fails. */
  async badSignature(identity = 'tampered-user', roomName?: string): Promise<string> {
    const jwt = await generateToken(identity, roomName);
    const [header, payload, signature] = jwt.split('.');
    // Flip one character of the signature, keeping the base64url alphabet.
    const flipped = (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);
    return `${header}.${payload}.${flipped}`;
  },
};

export { generateToken, badTokens, credentials };
