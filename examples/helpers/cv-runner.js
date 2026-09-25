// Shared scaffolding for the computer-vision examples.
//
// Each CV example connects to a room, subscribes to the first participant's
// webcam, runs a per-frame processor, and re-publishes the annotated result as
// its own video track. The only thing that differs between examples is the
// processor (what model runs and what it draws), so everything else — connect,
// publish, subscription, frame pacing, lifecycle — lives here.
//
// Results are communicated back through the published video track only (drawn
// onto the frame); the examples intentionally use no data track, so they work
// against any room a developer joins from a browser.
//
// CPU load is tunable via two environment variables: CV_MAX_FPS (max inferences
// per second, default 8, below) and CV_THREADS (ONNX Runtime threads per model,
// default 2, applied in helpers/onnx-model.js). Lower either to reduce CPU/heat.

const { connect, createLocalVideoTrack } = require('./sdk');
const { generateToken } = require('./token');
const { i420ToRgba } = require('./yuv');

// Run at most this many inferences per second. Inference on the CPU takes tens
// of milliseconds, so we skip frames that arrive inside this interval rather
// than analyzing every one. Lower it to cut CPU/heat; override with CV_MAX_FPS.
const MAX_FPS = Math.max(1, Number(process.env.CV_MAX_FPS) || 8);
const MIN_INTERVAL_MS = 1000 / MAX_FPS;

// options:
//   roomName, trackName, identity
//   createProcessor() -> async (rgba, width, height) -> VideoFrameInput | null
//     Called once at startup (e.g. to load the model). The returned function is
//     invoked per frame with a private RGBA copy and must return an I420
//     VideoFrameInput to publish, or null to skip the frame.
async function runCvExample(options) {
  const { roomName, trackName, identity = 'cv-agent', createProcessor } = options;

  console.log(`[cv] Loading model for "${trackName}"...`);
  const processor = await createProcessor();

  const outTrack = createLocalVideoTrack(trackName);
  console.log(`[cv] Connecting to room: ${roomName}`);
  const room = await connect(generateToken(identity, roomName), {
    name: roomName,
    videoTracks: [outTrack],
    enableAutomaticSubscription: true,
  });
  console.log(`[cv] Connected! Room: ${room.name} SID: ${room.sid}`);

  let processedFrames = 0;
  let frameCount = 0;
  let lastRun = 0;
  let boundTrackSid = null;

  // Consume frames until the track stops delivering them, which happens when it
  // is unsubscribed or the room disconnects. `mode: 'latest'` with a queue of
  // one means a frame arriving while inference runs replaces the queued one, so
  // the loop always picks up the newest frame instead of falling behind.
  async function analyzeTrack(track, participant) {
    for await (const frame of track.frames({ mode: 'latest', maxQueue: 1 })) {
      frameCount++;
      const now = Date.now();
      if (now - lastRun < MIN_INTERVAL_MS) {
        frame.close?.();
        continue;
      }
      lastRun = now;

      // Convert before releasing the frame, so the processor holds a private
      // copy across its async inference.
      let rgba, width, height, timestamp, rotation;
      try {
        ({ data: rgba, width, height } = i420ToRgba(frame));
        timestamp = frame.timestamp;
        rotation = frame.rotation;
      } catch (err) {
        console.error('[cv] frame decode error:', err);
        continue;
      } finally {
        frame.close?.();
      }

      try {
        const out = await processor(rgba, width, height);
        if (out) {
          outTrack.write({ ...out, timestamp, rotation });
          processedFrames++;
        }
      } catch (err) {
        console.error('[cv] processing error:', err);
      }
    }
    console.log(`[cv] Video stream ended for ${participant.identity}`);
    unbindTrack();
  }

  function handleTrack(track, participant) {
    if (track.kind !== 'video') return; // only analyze video, not audio/data
    // Bind to the first participant's video and ignore any others, so the shared
    // pacing state always describes one source.
    if (boundTrackSid !== null) return;
    boundTrackSid = track.sid;
    console.log(`[cv] Analyzing video from ${participant.identity}`);
    analyzeTrack(track, participant).catch(err => {
      console.error('[cv] analysis failed:', err);
      unbindTrack();
    });
  }

  // Release the binding so a later participant can be analyzed.
  function unbindTrack() {
    boundTrackSid = null;
  }

  // Subscribe using the repo's belt-and-suspenders pattern: handle the
  // trackSubscribed event and also poll for tracks that subscribed before the
  // listener was attached.
  function handleParticipant(participant) {
    console.log(`[cv] Participant: ${participant.identity}`);
    participant.on('trackSubscribed', track => handleTrack(track, participant));

    const poll = setInterval(() => {
      for (const pub of participant.videoTracks.values()) {
        if (pub.isSubscribed && pub.track) {
          handleTrack(pub.track, participant);
          clearInterval(poll);
          return;
        }
      }
    }, 100);
    setTimeout(() => clearInterval(poll), 30000);
  }

  room.participants.forEach(handleParticipant);
  room.on('participantConnected', handleParticipant);

  room.on('disconnected', (_room, error) => {
    console.log('[cv] Disconnected', error ? error.message : '');
    room.dispose();
    process.exit(error ? 1 : 0);
  });

  process.on('SIGINT', () => {
    console.log('\n[cv] Shutting down...');
    room.disconnect();
    setTimeout(() => process.exit(0), 1000);
  });

  setInterval(() => {
    console.log(`[cv] state=${room.state} frames=${frameCount} processed=${processedFrames}`);
  }, 5000);
}

module.exports = { runCvExample };
