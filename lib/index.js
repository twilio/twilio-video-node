const path = require('path');

let addon;
try {
    addon = require('../build/Release/twilio_video_sdk_node.node');
} catch (e) {
    try {
        addon = require('../build/Debug/twilio_video_sdk_node.node');
    } catch (e2) {
        throw new Error('Failed to load native addon. Run npm run build first.');
    }
}

/**
 * Connect to a Twilio Video room.
 * Returns a Promise that resolves with the Room on 'connected',
 * or rejects on 'connectFailure'.
 *
 * The raw synchronous connect is still used internally.
 * If you need immediate access to the room object (e.g. to register
 * additional event handlers before connection), use connectSync().
 */
function connect(options) {
    return new Promise((resolve, reject) => {
        const room = addon.connect(options);

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

module.exports = {
    getVersion: addon.getVersion,
    setLogLevel: addon.setLogLevel,
    connect,
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
