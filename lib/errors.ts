export class TwilioError extends Error {
  readonly code: number;

  constructor(code: number, message?: string) {
    super(message || '');
    this.code = code;
    this.name = 'TwilioError';
  }
}

export class AccessTokenInvalidError extends TwilioError {
  static readonly code = 20101;

  constructor(message?: string) {
    super(AccessTokenInvalidError.code, message || 'Invalid Access Token');
    this.name = 'AccessTokenInvalidError';
  }
}

export class SignalingConnectionError extends TwilioError {
  static readonly code = 53000;

  constructor(message?: string) {
    super(SignalingConnectionError.code, message || 'Signaling connection error');
    this.name = 'SignalingConnectionError';
  }
}

export class RoomNotFoundError extends TwilioError {
  static readonly code = 53106;

  constructor(message?: string) {
    super(RoomNotFoundError.code, message || 'Room not found');
    this.name = 'RoomNotFoundError';
  }
}

export class ParticipantMaxTracksExceededError extends TwilioError {
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

export class MediaConnectionError extends TwilioError {
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
 * Convert a value coming over the native event boundary into a `TwilioError`.
 * Already-lifted errors and `Error` instances pass their message through;
 * `{ code, message }` payloads route to the matching subclass; any other
 * payload preserves its `message` (or string value) rather than discarding it.
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
