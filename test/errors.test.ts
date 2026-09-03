import { describe, it, expect } from 'vitest';
import {
  TwilioError,
  SDK_LOCAL_CODE,
  AccessTokenInvalidError,
  AccessTokenHeaderInvalidError,
  AccessTokenIssuerInvalidError,
  AccessTokenExpiredError,
  AccessTokenNotYetValidError,
  AccessTokenGrantsInvalidError,
  AccessTokenSignatureInvalidError,
  SignalingConnectionError,
  SignalingConnectionDisconnectedError,
  SignalingConnectionTimeoutError,
  RoomConnectFailedError,
  RoomMaxParticipantsExceededError,
  RoomNotFoundError,
  RoomCompletedError,
  ParticipantMaxTracksExceededError,
  ParticipantDuplicateIdentityError,
  TrackInvalidError,
  TrackNameTooLongError,
  TrackNameCharsInvalidError,
  MediaClientLocalDescFailedError,
  MediaServerLocalDescFailedError,
  MediaClientRemoteDescFailedError,
  MediaServerRemoteDescFailedError,
  MediaNoSupportedCodecError,
  MediaConnectionError,
  NativeBindingLoadError,
  UnsupportedPlatformError,
  RoomConnectTimeoutError,
  DataTrackSendError,
  twilioErrorFromCode,
  liftTwilioError,
} from '../lib/errors.js';

/** Every Twilio-coded subclass, paired with the code it pins. */
const CODED = [
  [AccessTokenInvalidError, 20101],
  [AccessTokenHeaderInvalidError, 20102],
  [AccessTokenIssuerInvalidError, 20103],
  [AccessTokenExpiredError, 20104],
  [AccessTokenNotYetValidError, 20105],
  [AccessTokenGrantsInvalidError, 20106],
  [AccessTokenSignatureInvalidError, 20107],
  [SignalingConnectionError, 53000],
  [SignalingConnectionDisconnectedError, 53001],
  [SignalingConnectionTimeoutError, 53002],
  [RoomConnectFailedError, 53104],
  [RoomMaxParticipantsExceededError, 53105],
  [RoomNotFoundError, 53106],
  [RoomCompletedError, 53118],
  [ParticipantMaxTracksExceededError, 53203],
  [ParticipantDuplicateIdentityError, 53205],
  [TrackInvalidError, 53300],
  [TrackNameTooLongError, 53301],
  [TrackNameCharsInvalidError, 53303],
  [MediaClientLocalDescFailedError, 53400],
  [MediaServerLocalDescFailedError, 53401],
  [MediaClientRemoteDescFailedError, 53402],
  [MediaServerRemoteDescFailedError, 53403],
  [MediaNoSupportedCodecError, 53404],
  [MediaConnectionError, 53405],
] as const;

describe('Twilio-coded error subclasses', () => {
  it.each(CODED.map(([cls, code]) => [cls.name, cls, code] as const))(
    '%s pins code %i and is a TwilioError',
    (name, Cls, code) => {
      const err = new Cls();
      expect(err).toBeInstanceOf(TwilioError);
      expect(err).toBeInstanceOf(Error);
      expect(err.code).toBe(code);
      expect(Cls.code).toBe(code);
      // The class name must survive, or stacks and `instanceof` checks read as
      // anonymous.
      expect(err.name).toBe(name);
      expect(Cls.name).toBe(name);
      expect(err.message.length).toBeGreaterThan(0);
    },
  );

  it('allows overriding the canonical message', () => {
    expect(new RoomNotFoundError('custom text').message).toBe('custom text');
  });

  it('falls back to the canonical message when none is given', () => {
    expect(new RoomNotFoundError().message).toBe('Room not found');
  });

  it('assigns a distinct code to every subclass', () => {
    const codes = CODED.map(([, code]) => code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('TwilioError base', () => {
  it('carries the given code and message', () => {
    const err = new TwilioError(12345, 'explicit');
    expect(err.code).toBe(12345);
    expect(err.message).toBe('explicit');
    expect(err.name).toBe('TwilioError');
  });

  it('defaults to an empty message when none is given', () => {
    expect(new TwilioError(12345).message).toBe('');
  });
});

describe('SDK-local errors', () => {
  it.each([
    ['UnsupportedPlatformError', UnsupportedPlatformError],
    ['RoomConnectTimeoutError', RoomConnectTimeoutError],
    ['DataTrackSendError', DataTrackSendError],
  ] as const)('%s carries the SDK-local code', (name, Cls) => {
    const err = new Cls();
    expect(err).toBeInstanceOf(TwilioError);
    expect(err.code).toBe(SDK_LOCAL_CODE);
    expect(err.name).toBe(name);
  });

  it('NativeBindingLoadError carries the SDK-local code and preserves a cause', () => {
    const cause = new Error('dlopen failed');
    const err = new NativeBindingLoadError('no binary', { cause });
    expect(err).toBeInstanceOf(TwilioError);
    expect(err.code).toBe(SDK_LOCAL_CODE);
    expect(err.name).toBe('NativeBindingLoadError');
    expect(err.message).toBe('no binary');
    expect((err as Error & { cause?: unknown }).cause).toBe(cause);
  });

  it('NativeBindingLoadError works without a cause', () => {
    const err = new NativeBindingLoadError();
    expect(err.message).toBe('Failed to load the native addon');
    expect('cause' in err).toBe(false);
  });

  it('are not reachable via twilioErrorFromCode, since code 0 is not a Twilio code', () => {
    // Code 0 must stay a plain TwilioError: an SDK-local condition is
    // identified by class, and several share the code.
    expect(twilioErrorFromCode(0, 'x').constructor).toBe(TwilioError);
  });
});

describe('twilioErrorFromCode', () => {
  it.each(CODED.map(([cls, code]) => [code, cls.name] as const))('maps %i to %s', (code, name) => {
    expect(twilioErrorFromCode(code).name).toBe(name);
  });

  it('ignores a supplied message for a registered code, preferring the canonical one', () => {
    expect(twilioErrorFromCode(53106, 'ignored').message).toBe('Room not found');
  });

  it('preserves the message for an unregistered code', () => {
    const err = twilioErrorFromCode(59999, 'something new');
    expect(err.constructor).toBe(TwilioError);
    expect(err.code).toBe(59999);
    expect(err.message).toBe('something new');
  });

  it('treats a non-integer code as unknown', () => {
    for (const bad of [1.5, NaN, Infinity]) {
      const err = twilioErrorFromCode(bad, 'msg');
      expect(err.code).toBe(0);
      expect(err.message).toBe('msg');
    }
  });

  it('supplies a default message for a non-integer code with none given', () => {
    expect(twilioErrorFromCode(NaN).message).toBe('Unknown error');
  });
});

describe('liftTwilioError', () => {
  it('passes a TwilioError through unchanged', () => {
    const err = new RoomNotFoundError();
    expect(liftTwilioError(err)).toBe(err);
  });

  it('builds the matching subclass from a coded payload', () => {
    const lifted = liftTwilioError({ code: 53404, message: 'nope' });
    expect(lifted).toBeInstanceOf(MediaNoSupportedCodecError);
    expect(lifted.code).toBe(53404);
  });

  it('wraps a bare string', () => {
    expect(liftTwilioError('boom')).toMatchObject({ code: 0, message: 'boom' });
  });

  it('wraps a plain Error', () => {
    expect(liftTwilioError(new Error('kaboom'))).toMatchObject({ code: 0, message: 'kaboom' });
  });

  it('wraps an object carrying only a message', () => {
    expect(liftTwilioError({ message: 'partial' })).toMatchObject({ code: 0, message: 'partial' });
  });

  it('falls back for anything unrecognizable', () => {
    for (const raw of [undefined, null, 42, [], {}]) {
      expect(liftTwilioError(raw)).toMatchObject({ code: 0, message: 'Unknown error' });
    }
  });
});
