// Drift-compensated pacing for a pushable LocalAudioTrack.
//
// A LocalAudioTrack is a push source: it transmits exactly what write() is
// handed, with no notion of "play silence when idle". Naively writing one 10 ms
// frame per setInterval tick drifts — Node timers fire slightly late, so the
// track is fed just under 48 kHz and the native buffer periodically underruns,
// which is audible as clicking.
//
// This writer paces by wall-clock instead. Each tick it emits as many 10 ms
// frames as elapsed real time says it owes, keeping a small lead as a cushion
// and capping per-tick output so a GC pause can't trigger a burst. As a result
// the average output rate is exactly 48 kHz regardless of timer jitter.
//
// Audio to play is supplied with enqueue(); when the queue is empty the writer
// emits silence to keep the track warm and the pacing clock continuous. clear()
// drops queued audio instantly, which is what barge-in needs.
//
// Format is fixed to Twilio's LocalAudioTrack input: 48 kHz mono S16LE.

const SAMPLE_RATE = 48000;
const FRAME_SAMPLES = 480; // 10 ms @ 48 kHz
const FRAME_BYTES = FRAME_SAMPLES * 2;
const WRITER_TICK_MS = 10;
// Cushion held ahead of real-time in the native buffer. It must exceed the
// worst-case event-loop stall (e.g. a GC pause), or the buffer underruns during
// the stall and you hear an intermittent "bump". ~80 ms is a safe margin; raise
// it if bumps persist, at the cost of a little added output latency.
const LEAD_SAMPLES = FRAME_SAMPLES * 8; // ~80 ms cushion
// Must be large enough to refill the whole cushion in one tick after a stall.
const MAX_FRAMES_PER_TICK = 16;

function createPacedWriter(audioTrack) {
  const silence = Buffer.alloc(FRAME_BYTES);
  let pending = Buffer.alloc(0);
  let timer = null;
  let playStartMs = null;
  let samplesWritten = 0; // total samples emitted (audio + silence) since start
  let audioSamplesPlayed = 0; // real (non-silence) samples since the last reset

  function writeOneFrame() {
    let frame;
    if (pending.length >= FRAME_BYTES) {
      frame = pending.subarray(0, FRAME_BYTES);
      pending = pending.subarray(FRAME_BYTES);
      audioSamplesPlayed += FRAME_SAMPLES;
    } else if (pending.length > 0) {
      // Pad the final partial frame with silence.
      const tail = pending;
      frame = Buffer.concat([tail, silence.subarray(0, FRAME_BYTES - tail.length)]);
      pending = Buffer.alloc(0);
      audioSamplesPlayed += tail.length / 2;
    } else {
      frame = silence; // keep the track alive when idle
    }
    audioTrack.write({ pcm: frame, frames: FRAME_SAMPLES });
  }

  function pump() {
    const now = Date.now();
    if (playStartMs === null) {
      playStartMs = now;
      samplesWritten = 0;
    }
    const target = Math.floor(((now - playStartMs) / 1000) * SAMPLE_RATE) + LEAD_SAMPLES;
    // If we fell far behind (e.g. a long GC pause), resync instead of bursting.
    if (target - samplesWritten > SAMPLE_RATE) {
      samplesWritten = target - LEAD_SAMPLES;
    }
    let n = 0;
    while (samplesWritten < target && n < MAX_FRAMES_PER_TICK) {
      writeOneFrame();
      samplesWritten += FRAME_SAMPLES;
      n++;
    }
  }

  return {
    /** Start the paced writer (idempotent). */
    start() {
      if (timer) return;
      playStartMs = null;
      samplesWritten = 0;
      timer = setInterval(pump, WRITER_TICK_MS);
    },
    /** Stop the writer. */
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    /** Queue 48 kHz mono S16LE PCM for smooth playout. */
    enqueue(pcm48) {
      pending = Buffer.concat([pending, pcm48]);
    },
    /** Drop all queued audio immediately (e.g. on barge-in). */
    clear() {
      pending = Buffer.alloc(0);
    },
    /** Bytes of audio currently queued (0 when only silence is playing). */
    pendingBytes() {
      return pending.length;
    },
    /** Real (non-silence) samples emitted since the last resetPlayed(). */
    playedSamples() {
      return audioSamplesPlayed;
    },
    /** Milliseconds of real audio emitted since the last resetPlayed(). */
    playedMs() {
      return Math.floor((audioSamplesPlayed / SAMPLE_RATE) * 1000);
    },
    /** Reset the played counter (call at the start of each new response). */
    resetPlayed() {
      audioSamplesPlayed = 0;
    },
  };
}

module.exports = { createPacedWriter, SAMPLE_RATE, FRAME_SAMPLES };
