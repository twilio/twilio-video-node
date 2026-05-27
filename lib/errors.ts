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
      message || 'Participant has exceeded the maximum number of tracks',
    );
    this.name = 'ParticipantMaxTracksExceededError';
  }
}

export class MediaConnectionError extends TwilioError {
  static readonly code = 53405;

  constructor(message?: string) {
    super(MediaConnectionError.code, message || 'Media connection error');
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
 * Lift a `{ code, message }` payload coming from the native layer into the
 * matching `TwilioError` subclass, or a plain `TwilioError` when no specific
 * subclass is registered for the code.
 */
export function twilioErrorFromCode(code: number, message?: string): TwilioError {
  if (!Number.isInteger(code)) {
    return new TwilioError(0, message || 'Unknown error');
  }
  const Subclass = SUBCLASSES_BY_CODE[code];
  if (Subclass) {
    return new Subclass(message);
  }
  return new TwilioError(code, message);
}

/**
 * Convert a value coming over the native event boundary into a `TwilioError`.
 * Already-lifted errors pass through; `{ code, message }` payloads route to
 * the matching subclass; anything else becomes a generic `TwilioError(0)`.
 */
export function liftTwilioError(raw: unknown): TwilioError {
  if (raw instanceof TwilioError) return raw;
  if (raw && typeof raw === 'object' && typeof (raw as { code?: unknown }).code === 'number') {
    const { code, message } = raw as { code: number; message?: string };
    return twilioErrorFromCode(code, message);
  }
  return new TwilioError(0, typeof raw === 'string' ? raw : 'Unknown error');
}
