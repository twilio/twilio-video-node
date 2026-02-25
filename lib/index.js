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
    } catch (e1) {
        try {
            return require('../build/Debug/twilio_video_sdk_node.node');
        } catch (e2) {
            throw new Error(
                `No prebuilt binary found for ${platformDir}. ` +
                'Run npm run build to compile from source.'
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
        const onFailure = (error) => {
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

module.exports = {
    getVersion: addon.getVersion,
    setLogLevel: addon.setLogLevel,
    connect,
    createLocalVideoTrack,
    createLocalAudioTrack,
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
