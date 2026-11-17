import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { callVendor } from './helpers/vendor.js';
import { generateToken, badTokens } from './helpers/token.js';
import { createGroupRoom } from './helpers/rooms.js';

// Stub OIDC endpoint (GET /oidc) and credential vendor (POST /vendor).
interface Recorded {
  method: string;
  url: URL;
  authorization?: string;
  body?: Record<string, unknown>;
}

let server: http.Server;
let base: string;
let requests: Recorded[];
let oidcCount: number;
let vendorReply: (body: Record<string, unknown>) => { status: number; json: unknown };

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const url = new URL(req.url!, base);
      const raw = Buffer.concat(chunks).toString();
      const body = raw ? JSON.parse(raw) : undefined;
      requests.push({ method: req.method!, url, authorization: req.headers.authorization, body });
      const reply =
        url.pathname === '/oidc'
          ? { status: 200, json: { value: `oidc-jwt-${++oidcCount}` } }
          : vendorReply(body);
      res.writeHead(reply.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(reply.json));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

const ENV_KEYS = [
  'VENDOR_URL',
  'VENDOR_TOKEN',
  'ACTIONS_ID_TOKEN_REQUEST_URL',
  'ACTIONS_ID_TOKEN_REQUEST_TOKEN',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_API_KEY',
  'TWILIO_API_SECRET',
];
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  requests = [];
  oidcCount = 0;
  vendorReply = () => ({ status: 200, json: { token: 'vended.jwt.signature' } });
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function onRunner() {
  process.env.VENDOR_URL = `${base}/vendor`;
  // GitHub's request URL already carries a query string.
  process.env.ACTIONS_ID_TOKEN_REQUEST_URL = `${base}/oidc?api-version=2.0`;
  process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = 'runner-request-token';
}

const oidcRequests = () => requests.filter(r => r.url.pathname === '/oidc');
const vendorRequests = () => requests.filter(r => r.url.pathname === '/vendor');

describe('callVendor', () => {
  it('posts the action and params, authorized by an OIDC token minted for VENDOR_URL', async () => {
    onRunner();

    await callVendor('get-room', { roomSid: 'RM00' });

    const [oidc] = oidcRequests();
    expect(oidc.authorization).toBe('bearer runner-request-token');
    expect(oidc.url.searchParams.get('api-version')).toBe('2.0');
    expect(oidc.url.searchParams.get('audience')).toBe(`${base}/vendor`);
    const [vendor] = vendorRequests();
    expect(vendor.method).toBe('POST');
    expect(vendor.authorization).toBe('Bearer oidc-jwt-1');
    expect(vendor.body).toEqual({ action: 'get-room', roomSid: 'RM00' });
  });

  it('mints a new OIDC token for every call', async () => {
    onRunner();

    await callVendor('get-room', { roomSid: 'RM00' });
    await callVendor('get-room', { roomSid: 'RM01' });

    expect(vendorRequests().map(r => r.authorization)).toEqual([
      'Bearer oidc-jwt-1',
      'Bearer oidc-jwt-2',
    ]);
  });

  it('sends VENDOR_TOKEN when the runner provides no OIDC request token', async () => {
    process.env.VENDOR_URL = `${base}/vendor`;
    process.env.VENDOR_TOKEN = 'local-dev';

    await callVendor('get-room', { roomSid: 'RM00' });

    expect(oidcRequests()).toHaveLength(0);
    expect(vendorRequests()[0].authorization).toBe('Bearer local-dev');
  });

  it("rejects with the action, status and vendor's error, without the bearer token", async () => {
    onRunner();
    vendorReply = () => ({ status: 400, json: { error: 'Unsupported grant "chat"' } });

    const error: Error = await callVendor('mint-token', { grant: 'chat' }).catch(e => e);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('mint-token');
    expect(error.message).toContain('400');
    expect(error.message).toContain('Unsupported grant "chat"');
    expect(error.message).not.toContain('oidc-jwt');
  });
});

describe('token helpers with VENDOR_URL', () => {
  it.each([
    [
      'generateToken',
      () => generateToken('alice', 'room-1'),
      { identity: 'alice', grant: 'video', room: 'room-1', ttl: 3600 },
      'vended.jwt.signature',
    ],
    [
      'badTokens.expired',
      () => badTokens.expired(),
      { identity: 'expired-user', grant: 'video', ttl: -3600 },
      'vended.jwt.signature',
    ],
    [
      'badTokens.noVideoGrant',
      () => badTokens.noVideoGrant(),
      { identity: 'no-grant-user', grant: null, ttl: 600 },
      'vended.jwt.signature',
    ],
    [
      'badTokens.badSignature',
      () => badTokens.badSignature(),
      { identity: 'tampered-user', grant: 'video', ttl: 3600 },
      'vended.jwt.Aignature',
    ],
  ])('%s mints through the vendor', async (_name, make, params, expected) => {
    onRunner();

    const token = await make();

    expect(vendorRequests().map(r => r.body)).toEqual([{ action: 'mint-token', ...params }]);
    expect(token).toBe(expected);
  });
});

describe('createGroupRoom with VENDOR_URL', () => {
  beforeEach(() => {
    onRunner();
    vendorReply = body =>
      body.action === 'create-room'
        ? {
            status: 200,
            json: {
              uniqueName: body.name,
              sid: 'RMvended',
              videoCodecs: ['H264'],
              status: 'in-progress',
            },
          }
        : { status: 200, json: { sid: 'RMvended', status: 'completed' } };
  });

  it('creates a codec-restricted Group Room that closes itself', async () => {
    const room = await createGroupRoom({ videoCodecs: ['H264'] });

    const [create] = vendorRequests();
    expect(create.body).toEqual({
      action: 'create-room',
      name: expect.stringMatching(/^test-[0-9a-f-]{36}$/),
      type: 'group',
      roomOptions: { videoCodecs: ['H264'], emptyRoomTimeout: 1, unusedRoomTimeout: 1 },
    });
    expect(room).toMatchObject({ name: create.body!.name, sid: 'RMvended', videoCodecs: ['H264'] });
  });

  it('completes the room by its SID', async () => {
    const room = await createGroupRoom({ videoCodecs: ['H264'] });
    requests = [];

    await room.complete();

    expect(vendorRequests().map(r => r.body)).toEqual([
      { action: 'complete-room', nameOrSid: 'RMvended' },
    ]);
  });
});

describe('token helpers without VENDOR_URL', () => {
  it('sign locally with the TWILIO_* credentials and never call the vendor', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'ACtest';
    process.env.TWILIO_API_KEY = 'SKtest';
    process.env.TWILIO_API_SECRET = 'secret';

    const token = await generateToken('alice', 'room-1');

    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    expect(payload).toMatchObject({
      iss: 'SKtest',
      sub: 'ACtest',
      grants: { identity: 'alice', video: { room: 'room-1' } },
    });
    expect(requests).toHaveLength(0);
  });
});
