const fs = require('fs');
const path = require('path');
const { getPlatformDir, getPrebuiltPath } = require('../scripts/common');

const { version: SDK_VERSION } = require(path.join(__dirname, '..', 'package.json'));

function loadAddon() {
  const platformDir = getPlatformDir();
  const prebuiltPath = getPrebuiltPath(platformDir);

  if (fs.existsSync(prebuiltPath)) {
    return require(prebuiltPath);
  }

  try {
    return require('../build/Release/twilio_video_sdk_node.node');
  } catch (_) {
    try {
      return require('../build/Debug/twilio_video_sdk_node.node');
    } catch (cause) {
      throw new Error(
        `No prebuilt binary found for ${platformDir}. ` +
          'Run npm run build to compile from source.',
        { cause },
      );
    }
  }
}

const addon = loadAddon();

/**
 * @param {string} token - Twilio access token
 * @param {import('./index').ConnectOptions} [options]
 * @returns {Promise<import('./index').Room>}
 * @throws {import('./index').TwilioError} On connection failure (e.g. invalid token, room not found)
 */
function connect(token, options = {}) {
  options.platformInfo = {
    sdkVersion: SDK_VERSION,
    platformVersion: process.version.replace(/^v/, ''),
  };

  return new Promise((resolve, reject) => {
    const room = addon.connect(token, options);

    const onConnected = () => {
      room.off('connectFailure');
      resolve(room);
    };
    const onFailure = error => {
      room.off('connected');
      reject(error || new Error('Connection failed'));
    };

    room.on('connected', onConnected);
    room.on('connectFailure', onFailure);
  });
}

let defaultFactory = null;
function getDefaultMediaFactory() {
  if (!defaultFactory) {
    defaultFactory = new addon.MediaFactory();
  }
  return defaultFactory;
}

function createLocalVideoTrack(name) {
  return getDefaultMediaFactory().createVideoTrack(name ? { name } : {});
}

function createLocalAudioTrack(name) {
  return getDefaultMediaFactory().createAudioTrack(name ? { name } : {});
}

const ErrorCode = Object.freeze({
  ACCESS_TOKEN_INVALID: 20101,
  ACCESS_TOKEN_HEADER_INVALID: 20102,
  ACCESS_TOKEN_ISSUER_INVALID: 20103,
  ACCESS_TOKEN_EXPIRED: 20104,
  ACCESS_TOKEN_NOT_YET_VALID: 20105,
  ACCESS_TOKEN_GRANT_INVALID: 20106,
  ACCESS_TOKEN_SIGNATURE_INVALID: 20107,
  SIGNALING_CONNECTION_ERROR: 53000,
  SIGNALING_CONNECTION_DISCONNECTED: 53001,
  SIGNALING_CONNECTION_TIMEOUT: 53002,
  ROOM_NOT_FOUND: 53106,
  ROOM_CONNECT_FAILED: 53104,
  ROOM_MAX_PARTICIPANTS_EXCEEDED: 53105,
  ROOM_COMPLETED: 53118,
  PARTICIPANT_DUPLICATE_IDENTITY: 53205,
  TRACK_INVALID: 53300,
  TRACK_NAME_TOO_LONG: 53301,
  TRACK_NAME_CHARS_INVALID: 53303,
  MEDIA_CLIENT_LOCAL_DESC_FAILED: 53400,
  MEDIA_SERVER_LOCAL_DESC_FAILED: 53401,
  MEDIA_CLIENT_REMOTE_DESC_FAILED: 53402,
  MEDIA_SERVER_REMOTE_DESC_FAILED: 53403,
  MEDIA_NO_SUPPORTED_CODEC: 53404,
  MEDIA_CONNECTION_ERROR: 53405,
});

module.exports = {
  getVersion: addon.getVersion,
  setLogLevel: addon.setLogLevel,
  connect,
  createLocalVideoTrack,
  createLocalAudioTrack,
  ErrorCode,
  MediaFactory: addon.MediaFactory,
  Room: addon.Room,
  LocalParticipant: addon.LocalParticipant,
  RemoteParticipant: addon.RemoteParticipant,
  LocalVideoTrack: addon.LocalVideoTrack,
  LocalAudioTrack: addon.LocalAudioTrack,
  LocalDataTrack: addon.LocalDataTrack,
  RemoteVideoTrack: addon.RemoteVideoTrack,
  RemoteAudioTrack: addon.RemoteAudioTrack,
  RemoteDataTrack: addon.RemoteDataTrack,
};
