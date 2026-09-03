/**
 * Base class for all errors the SDK surfaces from Twilio. Carries a numeric
 * Twilio error `code` alongside the standard `Error` message. Subclasses pin a
 * specific code; an unmatched code is represented by a plain `TwilioError`.
 *
 * Errors raised by the SDK itself rather than by Twilio - a failed native
 * binding load, an unsupported runtime, a connect timeout - carry
 * {@link SDK_LOCAL_CODE} (`0`) and are identified by their class, since Twilio
 * has not allocated codes for conditions the service never sees.
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

/**
 * The `code` carried by errors the SDK raises locally. These conditions never
 * reach Twilio, so no service code describes them; match on the error class
 * instead.
 */
export const SDK_LOCAL_CODE = 0;

/** Constructor shape shared by every generated subclass. */
interface TwilioErrorClass {
  new (message?: string): TwilioError;
  readonly code: number;
}

/**
 * Build a `TwilioError` subclass pinned to one code, with a canonical message.
 *
 * Generated rather than hand-written: there are two dozen of these, they differ
 * only in name, code and message, and each hand-rolled copy is a place for the
 * code and the class to drift apart.
 */
function defineError(name: string, code: number, defaultMessage: string): TwilioErrorClass {
  const cls = class extends TwilioError {
    static readonly code = code;
    constructor(message?: string) {
      super(code, message || defaultMessage);
      this.name = name;
    }
  };
  // Without this the class reports as the anonymous expression name in stacks
  // and in `cls.name`.
  Object.defineProperty(cls, 'name', { value: name });
  return cls;
}

// --- Access token (201xx) ---

/** The access token passed to {@link connect} is malformed or otherwise invalid. Code `20101`. */
export const AccessTokenInvalidError = defineError(
  'AccessTokenInvalidError',
  20101,
  'Invalid Access Token',
);
/** The access token's header is invalid. Code `20102`. */
export const AccessTokenHeaderInvalidError = defineError(
  'AccessTokenHeaderInvalidError',
  20102,
  'Invalid Access Token header',
);
/** The access token's issuer or subject is invalid. Code `20103`. */
export const AccessTokenIssuerInvalidError = defineError(
  'AccessTokenIssuerInvalidError',
  20103,
  'Invalid Access Token issuer/subject',
);
/** The access token has expired. Code `20104`. */
export const AccessTokenExpiredError = defineError(
  'AccessTokenExpiredError',
  20104,
  'Access Token expired or expiration date invalid',
);
/** The access token is not yet valid. Code `20105`. */
export const AccessTokenNotYetValidError = defineError(
  'AccessTokenNotYetValidError',
  20105,
  'Access Token not yet valid',
);
/** The access token has no Video grant. Code `20106`. */
export const AccessTokenGrantsInvalidError = defineError(
  'AccessTokenGrantsInvalidError',
  20106,
  'Invalid Access Token grants',
);
/** The access token signature is invalid. Code `20107`. */
export const AccessTokenSignatureInvalidError = defineError(
  'AccessTokenSignatureInvalidError',
  20107,
  'Invalid Access Token signature',
);

// --- Signaling (530xx) ---

/** The client cannot establish or maintain the signaling connection. Code `53000`. */
export const SignalingConnectionError = defineError(
  'SignalingConnectionError',
  53000,
  'Signaling connection error',
);
/** The signaling connection was disconnected. Code `53001`. */
export const SignalingConnectionDisconnectedError = defineError(
  'SignalingConnectionDisconnectedError',
  53001,
  'Signaling connection disconnected',
);
/** The signaling connection timed out. Code `53002`. */
export const SignalingConnectionTimeoutError = defineError(
  'SignalingConnectionTimeoutError',
  53002,
  'Signaling connection timed out',
);

// --- Room (531xx) ---

/** Connecting to the Room failed. Code `53104`. */
export const RoomConnectFailedError = defineError(
  'RoomConnectFailedError',
  53104,
  'Unable to connect to Room',
);
/** The Room already holds its maximum number of participants. Code `53105`. */
export const RoomMaxParticipantsExceededError = defineError(
  'RoomMaxParticipantsExceededError',
  53105,
  'Room contains too many Participants',
);
/** {@link connect} targeted a Room that does not exist and cannot be created. Code `53106`. */
export const RoomNotFoundError = defineError('RoomNotFoundError', 53106, 'Room not found');
/** The Room has already completed. Code `53118`. */
export const RoomCompletedError = defineError('RoomCompletedError', 53118, 'Room completed');

// --- Participant (532xx) ---

/** Publishing would exceed the Room's maximum simultaneously published tracks. Code `53203`. */
export const ParticipantMaxTracksExceededError = defineError(
  'ParticipantMaxTracksExceededError',
  53203,
  'The maximum number of published tracks allowed in the Room at the same time has been reached',
);
/** Another participant is already connected with this identity. Code `53205`. */
export const ParticipantDuplicateIdentityError = defineError(
  'ParticipantDuplicateIdentityError',
  53205,
  'Participant disconnected because of duplicate identity',
);

// --- Track (533xx) ---

/** The track is invalid. Code `53300`. */
export const TrackInvalidError = defineError('TrackInvalidError', 53300, 'Track is invalid');
/** The track name is too long. Code `53301`. */
export const TrackNameTooLongError = defineError(
  'TrackNameTooLongError',
  53301,
  'Track name is too long',
);
/** The track name contains invalid characters. Code `53303`. */
export const TrackNameCharsInvalidError = defineError(
  'TrackNameCharsInvalidError',
  53303,
  'Track name contains invalid characters',
);

// --- Media (534xx) ---

/** The client could not create a local media description. Code `53400`. */
export const MediaClientLocalDescFailedError = defineError(
  'MediaClientLocalDescFailedError',
  53400,
  'Client is unable to create or apply a local media description',
);
/** The server could not create a local media description. Code `53401`. */
export const MediaServerLocalDescFailedError = defineError(
  'MediaServerLocalDescFailedError',
  53401,
  'Server is unable to create or apply a local media description',
);
/** The client could not apply a remote media description. Code `53402`. */
export const MediaClientRemoteDescFailedError = defineError(
  'MediaClientRemoteDescFailedError',
  53402,
  'Client is unable to apply a remote media description',
);
/** The server could not apply a remote media description. Code `53403`. */
export const MediaServerRemoteDescFailedError = defineError(
  'MediaServerRemoteDescFailedError',
  53403,
  'Server is unable to apply a remote media description',
);
/**
 * No codec the peers both support could be negotiated. Surfaced through
 * `trackSubscriptionFailed` when a remote track cannot be decoded - notably an
 * H.264-only track, which this SDK does not decode. Code `53404`.
 */
export const MediaNoSupportedCodecError = defineError(
  'MediaNoSupportedCodecError',
  53404,
  'No supported codec',
);
/** The media connection failed or media activity ceased. Code `53405`. */
export const MediaConnectionError = defineError(
  'MediaConnectionError',
  53405,
  'Media connection failed or Media activity ceased',
);

// --- SDK-local conditions ---
//
// These never reach Twilio, so no service code describes them. They carry
// SDK_LOCAL_CODE and are identified by class. Allocating private numeric codes
// was deliberately avoided: a future Twilio code could collide with one, and
// adding codes later is additive while changing them is not.

/** The native addon could not be loaded for this platform. */
export class NativeBindingLoadError extends TwilioError {
  constructor(message?: string, options?: { cause?: unknown }) {
    super(SDK_LOCAL_CODE, message || 'Failed to load the native addon');
    this.name = 'NativeBindingLoadError';
    if (options && 'cause' in options) {
      Object.defineProperty(this, 'cause', { value: options.cause, configurable: true });
    }
  }
}

/** The current platform, architecture, or Node version is not supported. */
export const UnsupportedPlatformError = defineError(
  'UnsupportedPlatformError',
  SDK_LOCAL_CODE,
  'Unsupported platform',
);

/** {@link connect} did not settle within `connectionTimeout`. */
export const RoomConnectTimeoutError = defineError(
  'RoomConnectTimeoutError',
  SDK_LOCAL_CODE,
  'Timed out connecting to the Room',
);

/** A `LocalDataTrack.send()` message could not be delivered. */
export const DataTrackSendError = defineError(
  'DataTrackSendError',
  SDK_LOCAL_CODE,
  'Failed to send data track message',
);

const SUBCLASSES_BY_CODE: Record<number, TwilioErrorClass> = {};
for (const cls of [
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
]) {
  SUBCLASSES_BY_CODE[cls.code] = cls;
}

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
