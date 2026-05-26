/**
 * Virtual Camera Example - pushes frames from generated_video.mp4 via ffmpeg
 *
 * Usage: node examples/virtual_camera.js [room-name]
 */

const { spawn } = require('child_process');
const path = require('path');
const { connect, createLocalVideoTrack } = require('../dist/index.cjs');
const { generateToken } = require('./helpers/token');

const ROOM_NAME = process.argv[2] || 'cpp-room';
const WIDTH = 1280;
const HEIGHT = 720;
const FRAME_SIZE = (WIDTH * HEIGHT * 3) / 2; // YUV420p
const FPS = 24;
const VIDEO_PATH = path.join(__dirname, 'generated_video.mp4');

async function main() {
  console.log('Connecting to room:', ROOM_NAME);

  const videoTrack = createLocalVideoTrack('virtual-camera');
  console.log('Created video track:', videoTrack.name);

  const room = await connect(generateToken('node-participant', ROOM_NAME), {
    name: ROOM_NAME,
    videoTracks: [videoTrack],
  });

  console.log('Connected! Room:', room.name, 'SID:', room.sid);
  const publisher = startPublishing(videoTrack);

  room.on('disconnected', error => {
    publisher.stop();
    console.log('Disconnected', error ? error.message : '');
    process.exit(0);
  });

  setInterval(() => {
    console.log('[tick] state:', room.state);
  }, 5000);

  process.on('SIGINT', () => {
    publisher.stop();
    room.disconnect();
    setTimeout(() => process.exit(0), 1000);
  });
}

function startPublishing(videoTrack) {
  let ffmpeg = null;
  let pushTimer = null;
  let stopped = false;
  let frameCount = 0;
  let buffer = Buffer.alloc(0);
  const frameQueue = [];

  function spawnFfmpeg() {
    ffmpeg = spawn(
      'ffmpeg',
      ['-i', VIDEO_PATH, '-f', 'rawvideo', '-pix_fmt', 'yuv420p', 'pipe:1'],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );

    ffmpeg.stdout.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= FRAME_SIZE) {
        frameQueue.push(buffer.subarray(0, FRAME_SIZE));
        buffer = buffer.subarray(FRAME_SIZE);
      }
    });

    ffmpeg.on('close', () => {
      if (!stopped) spawnFfmpeg();
    });
  }

  spawnFfmpeg();
  console.log('Starting frame push loop from', VIDEO_PATH);

  pushTimer = setInterval(() => {
    if (frameQueue.length === 0) return;
    const frame = frameQueue.shift();
    const ySize = WIDTH * HEIGHT;
    const uvSize = ySize / 4;
    const y = frame.subarray(0, ySize);
    const u = frame.subarray(ySize, ySize + uvSize);
    const v = frame.subarray(ySize + uvSize, ySize + uvSize + uvSize);
    videoTrack.write({
      y,
      u,
      v,
      width: WIDTH,
      height: HEIGHT,
      yStride: WIDTH,
      uStride: WIDTH / 2,
      vStride: WIDTH / 2,
      timestampNs: process.hrtime.bigint(),
    });
    frameCount++;
    if (frameCount % FPS === 0) console.log('Pushed frame', frameCount);
  }, 1000 / FPS);

  return {
    stop() {
      stopped = true;
      if (pushTimer) clearInterval(pushTimer);
      if (ffmpeg) ffmpeg.kill('SIGTERM');
    },
  };
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
