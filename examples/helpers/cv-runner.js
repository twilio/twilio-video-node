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

const { connect, createLocalVideoTrack } = require('../../dist/index.cjs');
const { generateToken } = require('./token');
const { i420ToRgba } = require('./yuv');

// Run at most this many inferences per second. Inference on the CPU takes tens
// of milliseconds, so we pace the loop and drop frames that arrive while an
// inference is still running rather than letting callbacks queue up. Lower it
// to cut CPU/heat; override with CV_MAX_FPS.
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
  let lastFrameAt = 0;
  let busy = false;
  let lastRun = 0;
  let activeTrack = null;
  const handledTrackSids = new Set();

  function onFrame(frame) {
    frameCount++;
    lastFrameAt = Date.now();
    if (busy || lastFrameAt - lastRun < MIN_INTERVAL_MS) return;
    lastRun = lastFrameAt;
    busy = true;

    // Convert synchronously, before the native frame buffer is recycled; the
    // processor then works on this private copy across its async inference. Any
    // decode error must still clear `busy`, or the pipeline wedges.
    let rgba, width, height, timestampNs, rotation;
    try {
      ({ data: rgba, width, height } = i420ToRgba(frame));
      timestampNs = frame.timestampNs;
      rotation = frame.rotation;
    } catch (err) {
      busy = false;
      console.error('[cv] frame decode error:', err.message);
      return;
    }

    Promise.resolve(processor(rgba, width, height))
      .then(out => {
        if (out) {
          outTrack.write({ ...out, timestampNs, rotation });
          processedFrames++;
        }
      })
      .catch(err => console.error('[cv] processing error:', err.message))
      .finally(() => {
        busy = false;
      });
  }

  // A single onFrame registration can fail to start (or can stall) with this
  // SDK, so we (re)register the sink a few times up front and re-arm it from a
  // watchdog below if frames stop arriving (mirrors examples/voice_agent.js).
  function registerFrameSink(track) {
    track.onFrame(onFrame);
  }

  function handleTrack(track, participant) {
    if (track.kind !== 'video') return; // only analyze video, not audio/data
    if (handledTrackSids.has(track.sid)) return;
    handledTrackSids.add(track.sid);
    activeTrack = track;
    console.log(`[cv] Analyzing video from ${participant.identity}`);
    registerFrameSink(track);
    setTimeout(() => registerFrameSink(track), 1000);
    setTimeout(() => registerFrameSink(track), 3000);
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

  // Watchdog: if frames were flowing but stopped for >2s, re-register the sink.
  const watchdog = setInterval(() => {
    if (activeTrack && frameCount > 0 && Date.now() - lastFrameAt > 2000) {
      console.log('[cv] Video stalled — re-registering frame sink');
      registerFrameSink(activeTrack);
    }
  }, 2000);

  room.on('disconnected', error => {
    console.log('[cv] Disconnected', error ? error.message : '');
    process.exit(error ? 1 : 0);
  });

  process.on('SIGINT', () => {
    console.log('\n[cv] Shutting down...');
    clearInterval(watchdog);
    // Detach the frame sink before disconnecting to avoid a native teardown race.
    if (activeTrack && activeTrack.removeFrameCallback) activeTrack.removeFrameCallback();
    room.disconnect();
    setTimeout(() => process.exit(0), 1000);
  });

  setInterval(() => {
    console.log(`[cv] state=${room.state} frames=${frameCount} processed=${processedFrames}`);
  }, 5000);
}

module.exports = { runCvExample, MAX_FPS };
