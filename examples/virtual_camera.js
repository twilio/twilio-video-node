/**
 * Simplified Virtual Camera Example - Video only
 */

const { connect, MediaFactory } = require('../lib');

const ROOM_NAME = process.argv[2] || 'cpp-room';
const TOKEN = process.env.TWILIO_ACCESS_TOKEN;

if (!TOKEN) {
    console.error('Error: TWILIO_ACCESS_TOKEN environment variable is required');
    process.exit(1);
}

async function main() {
    console.log('Connecting to room:', ROOM_NAME);

    const mediaFactory = new MediaFactory();
    const videoTrack = mediaFactory.createVideoTrack({ name: 'virtual-camera' });
    console.log('Created video track:', videoTrack.name);

    console.log('Calling connect()...');
    const room = await connect({
        token: TOKEN,
        roomName: ROOM_NAME,
        mediaFactory: mediaFactory,
        videoTracks: [videoTrack],
    });

    console.log('Connected! Room:', room.name, 'SID:', room.sid);
    const publishInterval = startPublishing(videoTrack);

    room.on('disconnected', (error) => {
        clearInterval(publishInterval);
        console.log('Disconnected', error ? error.message : '');
        process.exit(0);
    });

    setInterval(() => {
        console.log('[tick] state:', room.state);
    }, 5000);

    process.on('SIGINT', () => {
        clearInterval(publishInterval);
        room.disconnect();
        setTimeout(() => process.exit(0), 1000);
    });
}

function startPublishing(videoTrack) {
    const width = 640, height = 480;
    let frame = 0;

    console.log('Starting frame push loop...');
    return setInterval(() => {
        const y = Buffer.alloc(width * height, 128 + Math.sin(frame * 0.1) * 50);
        const u = Buffer.alloc(width * height / 4, 85);
        const v = Buffer.alloc(width * height / 4, 85);
        videoTrack.pushFrame(y, u, v, width, height);
        frame++;
        if (frame % 30 === 0) console.log('Pushed frame', frame);
    }, 33);
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
