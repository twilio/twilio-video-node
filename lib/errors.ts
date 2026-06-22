/**
 * Base class for all errors the SDK surfaces from Twilio. Carries a numeric
 * Twilio error `code` alongside the standard `Error` message. Subclasses pin a
 * specific code; an unmatched code is represented by a plain `TwilioError`.
 */
export class TwilioError extends Error {
  /** The Twilio error code identifying the failure. See {@link ErrorCode} for known values. */
  readonly code: number;

  constructor(code: number, message?: string) {
    super(message || '');
    this.code = code;
    this.name = 'TwilioError';
  }
}

/** Raised when the access token passed to {@link connect} is malformed or otherwise invalid. Code `20101`. */
export class AccessTokenInvalidError extends TwilioError {
  /** The fixed Twilio code for this error: `20101`. */
  static readonly code = 20101;

  constructor(message?: string) {
    super(AccessTokenInvalidError.code, message || 'Invalid Access Token');
    this.name = 'AccessTokenInvalidError';
  }
}

/** Raised when the client cannot establish or maintain the signaling connection to Twilio. Code `53000`. */
export class SignalingConnectionError extends TwilioError {
  /** The fixed Twilio code for this error: `53000`. */
  static readonly code = 53000;

  constructor(message?: string) {
    super(SignalingConnectionError.code, message || 'Signaling connection error');
    this.name = 'SignalingConnectionError';
  }
}

/** Raised when {@link connect} targets a Room that does not exist (and cannot be created). Code `53106`. */
export class RoomNotFoundError extends TwilioError {
  /** The fixed Twilio code for this error: `53106`. */
  static readonly code = 53106;

  constructor(message?: string) {
    super(RoomNotFoundError.code, message || 'Room not found');
    this.name = 'RoomNotFoundError';
  }
}

/** Raised when publishing a track would exceed the Room's maximum number of simultaneously published tracks. Code `53203`. */
export class ParticipantMaxTracksExceededError extends TwilioError {
  /** The fixed Twilio code for this error: `53203`. */
  static readonly code = 53203;

  constructor(message?: string) {
    super(
      ParticipantMaxTracksExceededError.code,
      message ||
        'The maximum number of published tracks allowed in the Room at the same time has been reached',
    );
    this.name = 'ParticipantMaxTracksExceededError';
  }
}

/** Raised when the media (PeerConnection) fails to connect or media activity ceases. Code `53405`. */
export class MediaConnectionError extends TwilioError {
  /** The fixed Twilio code for this error: `53405`. */
  static readonly code = 53405;

  constructor(message?: string) {
    super(MediaConnectionError.code, message || 'Media connection failed or Media activity ceased');
    this.name = 'MediaConnectionError';
  }
}

const SUBCLASSES_BY_CODE: Record<number, new (message?: string) => TwilioError> = {
  [AccessTokenInvalidError.code]: AccessTokenInvalidError,
  [SignalingConnectionError.code]: SignalingConnectionError,
  [RoomNotFoundError.code]: RoomNotFoundError,
  [ParticipantMaxTracksExceededError.code]: ParticipantMaxTracksExceededError,
  [MediaConnectionError.code]: MediaConnectionError,
};

/**
 * Build a `TwilioError` (or matching subclass) from a numeric error code.
 * For a registered code the subclass's canonical message is used and any
 * supplied `message` is ignored. For an unregistered code the supplied
 * `message` is preserved.
 */
export function twilioErrorFromCode(code: number, message?: string): TwilioError {
  if (!Number.isInteger(code)) {
    return new TwilioError(0, message || 'Unknown error');
  }
  const Subclass = SUBCLASSES_BY_CODE[code];
  if (Subclass) {
    return new Subclass();
  }
  return new TwilioError(code, message);
}

/**
 * Normalize an SDK-emitted error payload into a `TwilioError`.
 *
 * @internal SDK-emitted payloads only. An unrecognized code keeps its `message`
 * verbatim, so never pass untrusted input.
 */
export function liftTwilioError(raw: unknown): TwilioError {
  if (raw instanceof TwilioError) return raw;
  if (raw && typeof raw === 'object' && typeof (raw as { code?: unknown }).code === 'number') {
    const { code, message } = raw as { code: number; message?: string };
    return twilioErrorFromCode(code, message);
  }
  if (typeof raw === 'string') return new TwilioError(0, raw);
  if (raw instanceof Error) return new TwilioError(0, raw.message);
  if (
    raw &&
    typeof raw === 'object' &&
    typeof (raw as { message?: unknown }).message === 'string'
  ) {
    return new TwilioError(0, (raw as { message: string }).message);
  }
  return new TwilioError(0, 'Unknown error');
}
