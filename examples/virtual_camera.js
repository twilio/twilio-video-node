/**
 * Twilio Video Media Streams SDK - Virtual Camera Example
 *
 * This example demonstrates:
 * 1. Connecting to a Twilio Video Group Room as a server-side participant
 * 2. Publishing synthetic video (gray frames) and audio (silence)
 * 3. Receiving decoded video frames (YUV I420) and audio (PCM) from remote participants
 *
 * Usage:
 *   TWILIO_ACCESS_TOKEN=<token> node examples/virtual_camera.js [room-name]
 */

const { connect, MediaFactory } = require('../lib');

const ROOM_NAME = process.argv[2] || 'test-room';
const TOKEN = process.env.TWILIO_ACCESS_TOKEN;

if (!TOKEN) {
    console.error('Error: TWILIO_ACCESS_TOKEN environment variable is required');
    process.exit(1);
}

async function main() {
    console.log('Twilio Video Media Streams SDK - Virtual Camera Example');
    console.log('========================================================');
    console.log('');
    console.log('This example demonstrates ALL observer callbacks:');
    console.log('');
    console.log('Room Events:');
    console.log('  - connected, disconnected, connectFailure');
    console.log('  - reconnecting, reconnected');
    console.log('  - participantConnected, participantDisconnected');
    console.log('  - dominantSpeakerChanged');
    console.log('  - recordingStarted, recordingStopped');
    console.log('');
    console.log('Participant Events (per remote participant):');
    console.log('  - trackPublished, trackUnpublished');
    console.log('  - trackSubscribed, trackUnsubscribed');
    console.log('  - trackEnabled, trackDisabled');
    console.log('  - networkQualityLevelChanged');
    console.log('');
    console.log('To test: Join the room from a browser or another client');
    console.log('========================================================\n');

    const mediaFactory = new MediaFactory();

    const videoTrack = mediaFactory.createVideoTrack({ name: 'virtual-camera' });
    const audioTrack = mediaFactory.createAudioTrack({ name: 'virtual-mic' });
    const dataTrack = mediaFactory.createDataTrack({ name: 'data-channel' });

    console.log(`Created local tracks:`);
    console.log(`  - Video: ${videoTrack.name}`);
    console.log(`  - Audio: ${audioTrack.name}`);
    console.log(`  - Data: ${dataTrack.name}\n`);

    console.log(`Connecting to room: ${ROOM_NAME}...`);
    console.log('About to call connect()...');

    const room = connect({
        token: TOKEN,
        roomName: ROOM_NAME,
        videoTracks: [videoTrack],
        audioTracks: [audioTrack],
        dataTracks: [dataTrack],
        enableInsights: true,
        enableDominantSpeaker: true,
        enableNetworkQuality: true,
        enableAutomaticSubscription: true,
        platformInfo: {
            sdkVersion: '1.0.0',
            platformName: 'nodejs',
            platformVersion: process.version,
            deviceArchitecture: process.arch,
            deviceManufacturer: 'n/a',
            deviceModel: 'n/a'
        }
    });

    console.log('connect() returned:', room);
    console.log('room type:', typeof room);
    console.log('room.on type:', typeof room.on);

    // Room-level event listeners
    room.on('connected', () => {
        console.log('\n========================================');
        console.log('EVENT: connected');
        console.log('========================================');
        console.log(`Room name: ${room.name}`);
        console.log(`Room SID: ${room.sid}`);
        console.log(`Room state: ${room.state}`);
        console.log(`Media region: ${room.mediaRegion}`);
        console.log(`Recording: ${room.isRecording ? 'YES' : 'NO'}`);
        console.log(`Local participant: ${room.localParticipant.identity} (${room.localParticipant.sid})`);
        console.log(`Remote participants: ${room.remoteParticipants.length}`);
        console.log('========================================\n');

        for (const participant of room.remoteParticipants) {
            setupParticipant(participant);
        }

        intervalCleanup = startPublishing(videoTrack, dataTrack);
    });

    room.on('disconnected', (error) => {
        console.log('\n========================================');
        console.log('EVENT: disconnected');
        console.log('========================================');
        if (error) {
            console.log(`Error: ${error.message} (code: ${error.code})`);
        } else {
            console.log('Clean disconnect');
        }
        console.log('========================================\n');
        process.exit(0);
    });

    room.on('connectFailure', (error) => {
        console.log('\n========================================');
        console.log('EVENT: connectFailure');
        console.log('========================================');
        console.log(`Error: ${error.message} (code: ${error.code})`);
        console.log('========================================\n');
        process.exit(1);
    });

    room.on('reconnecting', (error) => {
        console.log('\n========================================');
        console.log('EVENT: reconnecting');
        console.log('========================================');
        console.log(`Reason: ${error.message}`);
        console.log('========================================\n');
    });

    room.on('reconnected', () => {
        console.log('\n========================================');
        console.log('EVENT: reconnected');
        console.log('========================================');
        console.log('Successfully reconnected to room');
        console.log('========================================\n');
    });

    room.on('participantConnected', (participant) => {
        console.log('\n========================================');
        console.log('EVENT: participantConnected');
        console.log('========================================');
        console.log(`Identity: ${participant.identity}`);
        console.log(`SID: ${participant.sid}`);
        console.log(`State: ${participant.state}`);
        console.log(`Network quality: ${participant.networkQualityLevel}`);
        console.log('========================================\n');
        setupParticipant(participant);
    });

    room.on('participantDisconnected', (participant) => {
        console.log('\n========================================');
        console.log('EVENT: participantDisconnected');
        console.log('========================================');
        console.log(`Identity: ${participant.identity}`);
        console.log(`SID: ${participant.sid}`);
        console.log('========================================\n');
    });

    room.on('dominantSpeakerChanged', (participant) => {
        console.log('\n========================================');
        console.log('EVENT: dominantSpeakerChanged');
        console.log('========================================');
        if (participant) {
            console.log(`New dominant speaker: ${participant.identity}`);
        } else {
            console.log('No dominant speaker');
        }
        console.log('========================================\n');
    });

    room.on('recordingStarted', () => {
        console.log('\n========================================');
        console.log('EVENT: recordingStarted');
        console.log('========================================');
        console.log('Room recording has started');
        console.log('========================================\n');
    });

    room.on('recordingStopped', () => {
        console.log('\n========================================');
        console.log('EVENT: recordingStopped');
        console.log('========================================');
        console.log('Room recording has stopped');
        console.log('========================================\n');
    });

    console.log('Event listeners registered. Waiting for connection...\n');

    // Single SIGINT handler for clean shutdown
    let intervalCleanup = null;

    process.on('SIGINT', () => {
        console.log('\n========================================');
        console.log('Shutting down...');
        console.log('========================================');

        // Clean up publishing intervals if they exist
        if (intervalCleanup) {
            console.log('Stopping media publishing...');
            intervalCleanup();
        }

        // Disconnect from room
        console.log('Disconnecting from room...');
        room.disconnect();

        // Force exit after 2 seconds if disconnect event doesn't fire
        setTimeout(() => {
            console.log('Force exit after timeout');
            process.exit(0);
        }, 2000);
    });
}

function setupParticipant(participant) {
    console.log(`Setting up participant: ${participant.identity}`);
    console.log(`  - Video tracks: ${participant.videoTracks.length}`);
    console.log(`  - Audio tracks: ${participant.audioTracks.length}`);
    console.log(`  - Data tracks: ${participant.dataTracks.length}`);

    for (const pub of participant.videoTracks) {
        if (pub.isSubscribed && pub.track) {
            setupVideoTrack(pub.track, participant.identity);
        }
    }

    for (const pub of participant.audioTracks) {
        if (pub.isSubscribed && pub.track) {
            setupAudioTrack(pub.track, participant.identity);
        }
    }

    for (const pub of participant.dataTracks) {
        if (pub.isSubscribed && pub.track) {
            setupDataTrack(pub.track, participant.identity);
        }
    }

    // Track subscription events
    participant.on('trackSubscribed', (track, publication) => {
        console.log('\n----------------------------------------');
        console.log(`[${participant.identity}] EVENT: trackSubscribed`);
        console.log('----------------------------------------');
        console.log(`Track SID: ${track.sid}`);
        console.log(`Track name: ${track.name}`);
        console.log(`Track kind: ${publication.kind}`);
        console.log(`Publication SID: ${publication.trackSid}`);
        console.log('----------------------------------------\n');

        if (track.sid.startsWith('MT')) {
            setupVideoTrack(track, participant.identity);
        } else if (track.sid.startsWith('MS')) {
            setupAudioTrack(track, participant.identity);
        } else if (track.sid.startsWith('MD')) {
            setupDataTrack(track, participant.identity);
        }
    });

    participant.on('trackUnsubscribed', (track, publication) => {
        console.log('\n----------------------------------------');
        console.log(`[${participant.identity}] EVENT: trackUnsubscribed`);
        console.log('----------------------------------------');
        console.log(`Track SID: ${track.sid}`);
        console.log(`Track name: ${track.name}`);
        console.log(`Track kind: ${publication.kind}`);
        console.log('----------------------------------------\n');
    });

    participant.on('trackPublished', (publication) => {
        console.log('\n----------------------------------------');
        console.log(`[${participant.identity}] EVENT: trackPublished`);
        console.log('----------------------------------------');
        console.log(`Track SID: ${publication.trackSid}`);
        console.log(`Track name: ${publication.trackName}`);
        console.log(`Track kind: ${publication.kind}`);
        console.log('----------------------------------------\n');
    });

    participant.on('trackUnpublished', (publication) => {
        console.log('\n----------------------------------------');
        console.log(`[${participant.identity}] EVENT: trackUnpublished`);
        console.log('----------------------------------------');
        console.log(`Track SID: ${publication.trackSid}`);
        console.log(`Track name: ${publication.trackName}`);
        console.log(`Track kind: ${publication.kind}`);
        console.log('----------------------------------------\n');
    });

    participant.on('trackEnabled', (publication) => {
        console.log('\n----------------------------------------');
        console.log(`[${participant.identity}] EVENT: trackEnabled`);
        console.log('----------------------------------------');
        console.log(`Track SID: ${publication.trackSid}`);
        console.log(`Track name: ${publication.trackName}`);
        console.log(`Track kind: ${publication.kind}`);
        console.log('----------------------------------------\n');
    });

    participant.on('trackDisabled', (publication) => {
        console.log('\n----------------------------------------');
        console.log(`[${participant.identity}] EVENT: trackDisabled`);
        console.log('----------------------------------------');
        console.log(`Track SID: ${publication.trackSid}`);
        console.log(`Track name: ${publication.trackName}`);
        console.log(`Track kind: ${publication.kind}`);
        console.log('----------------------------------------\n');
    });

    participant.on('networkQualityLevelChanged', (level) => {
        console.log('\n----------------------------------------');
        console.log(`[${participant.identity}] EVENT: networkQualityLevelChanged`);
        console.log('----------------------------------------');
        console.log(`New level: ${level}`);
        console.log('----------------------------------------\n');
    });
}

function setupVideoTrack(track, participantIdentity) {
    console.log(`[${participantIdentity}] Setting up video track: ${track.name} (${track.sid})`);

    let frameCount = 0;
    const startTime = Date.now();

    track.onFrame((yPlane, uPlane, vPlane, metadata) => {
        frameCount++;

        if (frameCount === 1) {
            console.log(`[${participantIdentity}] First video frame received!`);
            console.log(`  Resolution: ${metadata.width}x${metadata.height}`);
            console.log(`  Rotation: ${metadata.rotation}°`);
            console.log(`  Y plane: ${yPlane.length} bytes`);
            console.log(`  U plane: ${uPlane.length} bytes`);
            console.log(`  V plane: ${vPlane.length} bytes`);
        }

        if (frameCount % 30 === 0) {
            const elapsed = (Date.now() - startTime) / 1000;
            const fps = frameCount / elapsed;
            console.log(`[${participantIdentity}] Video: ${metadata.width}x${metadata.height} @ ${fps.toFixed(1)} fps (frame ${frameCount})`);
        }
    });
}

function setupAudioTrack(track, participantIdentity) {
    console.log(`[${participantIdentity}] Setting up audio track: ${track.name} (${track.sid})`);

    let sampleCount = 0;
    const startTime = Date.now();
    let firstPacket = true;

    track.onData((samples, metadata) => {
        sampleCount += metadata.numberOfFrames;

        if (firstPacket) {
            console.log(`[${participantIdentity}] First audio packet received!`);
            console.log(`  Sample rate: ${metadata.sampleRate}Hz`);
            console.log(`  Channels: ${metadata.numberOfChannels}`);
            console.log(`  Bits per sample: ${metadata.bitsPerSample}`);
            console.log(`  Frames in packet: ${metadata.numberOfFrames}`);
            firstPacket = false;
        }

        if (sampleCount % (metadata.sampleRate * 5) < metadata.numberOfFrames) {
            const elapsed = (Date.now() - startTime) / 1000;
            console.log(`[${participantIdentity}] Audio: ${metadata.sampleRate}Hz, ${metadata.numberOfChannels}ch, ${sampleCount} samples in ${elapsed.toFixed(1)}s`);
        }
    });
}

function setupDataTrack(track, participantIdentity) {
    console.log(`[${participantIdentity}] Setting up data track: ${track.name} (${track.sid})`);

    let messageCount = 0;

    track.onMessage((data) => {
        messageCount++;
        if (typeof data === 'string') {
            console.log(`[${participantIdentity}] Data message #${messageCount}: ${data}`);
        } else {
            console.log(`[${participantIdentity}] Data binary #${messageCount}: ${data.length} bytes`);
        }
    });
}

function startPublishing(videoTrack, dataTrack) {
    const width = 640;
    const height = 480;
    const ySize = width * height;
    const uvSize = (width / 2) * (height / 2);

    let frameNum = 0;

    console.log('\n========================================');
    console.log('Starting local media publishing');
    console.log('========================================');
    console.log('Video: 640x480 @ 30fps (grayscale sine wave)');
    console.log('Data: Heartbeat every 5 seconds');
    console.log('========================================\n');

    const videoInterval = setInterval(() => {
        const gray = 128 + Math.sin(frameNum * 0.1) * 50;
        const yPlane = Buffer.alloc(ySize, Math.floor(gray));
        const uPlane = Buffer.alloc(uvSize, 128);
        const vPlane = Buffer.alloc(uvSize, 128);

        videoTrack.pushFrame(yPlane, uPlane, vPlane, width, height);
        frameNum++;

        if (frameNum === 1) {
            console.log('First video frame pushed to track');
        }
    }, 33);

    const dataInterval = setInterval(() => {
        const message = JSON.stringify({
            type: 'heartbeat',
            timestamp: Date.now(),
            frameNum
        });
        dataTrack.send(message);
        console.log(`Sent data heartbeat (frame ${frameNum})`);
    }, 5000);

    // Return cleanup function
    return () => {
        clearInterval(videoInterval);
        clearInterval(dataInterval);
    };
}

main().catch((err) => {
    console.error('Error:', err);
    process.exit(1);
});
