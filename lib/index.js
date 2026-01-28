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

module.exports = {
    getVersion: addon.getVersion,
    connect: addon.connect,
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
