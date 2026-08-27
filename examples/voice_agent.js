/**
 * Voice Agent — bridges a Twilio Video room to the OpenAI Realtime API.
 *
 * The agent joins the room as a participant, forwards the human participant's
 * microphone audio to OpenAI's Realtime API, and plays OpenAI's spoken response
 * back into the room. It supports natural barge-in: when the human starts
 * talking over the agent, the in-flight response is cancelled and truncated.
 *
 * Audio plumbing:
 *   - Twilio delivers/accepts 48 kHz mono S16LE PCM.
 *   - OpenAI Realtime here is configured for 24 kHz PCM in and out.
 *   - We downsample 48k -> 24k on the way in and upsample 24k -> 48k on the way
 *     out, using the anti-aliased resampler in helpers/audio-resampler.js.
 *   - Outgoing agent audio is played through a self-paced 10 ms writer so it
 *     streams smoothly and can be flushed instantly on interruption.
 *
 * Environment variables (loaded from the repo-root .env via helpers/token.js):
 *   TWILIO_ACCOUNT_SID, TWILIO_API_KEY, TWILIO_API_SECRET
 *   OPENAI_API_KEY                 — required
 *   OPENAI_REALTIME_MODEL          — optional (default: gpt-realtime-2.1)
 *   VOICE_AGENT_VOICE              — optional (default: alloy)
 *
 * Requirements: Node.js >= 24 (uses the global WebSocket), x64 (see README).
 *
 * Usage: node examples/voice_agent.js [room-name]
 */

/* global WebSocket */

const { connect, createLocalAudioTrack } = require('../dist/index.cjs');
const { generateToken } = require('./helpers/token');
const { createDownsampler, createUpsampler } = require('./helpers/audio-resampler');
const { createPacedWriter, SAMPLE_RATE } = require('./helpers/paced-audio-writer');

const ROOM_NAME = process.argv[2] || 'voice-agent-room';
const IDENTITY = 'voice-agent';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-2.1';
const OPENAI_REALTIME_URL = `wss://api.openai.com/v1/realtime?model=${MODEL}`;
const VOICE = process.env.VOICE_AGENT_VOICE || 'alloy';

const INSTRUCTIONS =
  'You are a helpful voice assistant. Keep responses short — one or two ' +
  'sentences. Answer directly, no filler or preamble. Speak like a real ' +
  'person having a quick, friendly conversation, not like a chatbot reading a ' +
  'presentation. Introduce yourself briefly at the start of the call.';

// OpenAI Realtime is configured for 24 kHz PCM; Twilio audio is 48 kHz mono.
const OPENAI_RATE = 24000;

// Batch input audio to OpenAI in ~200 ms chunks to limit WS message rate.
const INPUT_BATCH_THRESHOLD = 4800; // bytes of 24 kHz PCM (~100 ms)
const INPUT_BATCH_FLUSH_MS = 200;

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_MS = 100;
const RECONNECT_CAP_MS = 5000;

class VoiceAgent {
  constructor(audioTrack) {
    this.ws_ = null;

    this.downsampler_ = createDownsampler();
    this.upsampler_ = createUpsampler();

    // Outgoing playout: drift-compensated 10 ms writer over the local track.
    this.writer_ = createPacedWriter(audioTrack);

    // Incoming batching.
    this.inputBatchBuf_ = [];
    this.inputBatchBytes_ = 0;
    this.inputBatchInterval_ = null;

    // Realtime response bookkeeping (for interruption/truncation).
    this.currentResponseId_ = null;
    this.currentItemId_ = null;
    this.currentContentIdx_ = 0;

    this.audioFrameCount_ = 0;
    this.warnedNonStandardInput_ = false;
    this.lastFrameAt_ = 0;

    this.intentionalClose_ = false;
    this.reconnectAttempts_ = 0;
  }

  start() {
    this.writer_.start();
    this.connectWebSocket_();
  }

  frameCount() {
    return this.audioFrameCount_;
  }

  lastFrameAt() {
    return this.lastFrameAt_;
  }

  // --- Incoming room audio -> OpenAI --------------------------------------

  onRoomAudio(frame) {
    if (!this.ws_ || this.ws_.readyState !== WebSocket.OPEN) return;

    this.audioFrameCount_++;
    this.lastFrameAt_ = Date.now();
    if (this.audioFrameCount_ === 1) console.log('[agent] Receiving audio from the room');

    let pcm = frame.pcm;

    // This example assumes 48 kHz mono in. Downmix stereo; warn on other rates.
    if (frame.channels === 2) pcm = downmixStereo(pcm);
    if (frame.sampleRate !== SAMPLE_RATE && !this.warnedNonStandardInput_) {
      this.warnedNonStandardInput_ = true;
      console.warn(
        `[agent] Warning: expected ${SAMPLE_RATE} Hz input but got ${frame.sampleRate} Hz; ` +
          'resampling assumes 48 kHz and audio may be distorted.',
      );
    }

    const pcm24 = this.downsampler_.process(pcm);
    this.batchInputAudio_(pcm24);
  }

  batchInputAudio_(pcm24) {
    this.inputBatchBuf_.push(pcm24);
    this.inputBatchBytes_ += pcm24.length;
    if (this.inputBatchBytes_ >= INPUT_BATCH_THRESHOLD) this.flushInputBatch_();
    if (!this.inputBatchInterval_) {
      this.inputBatchInterval_ = setInterval(() => {
        if (this.inputBatchBuf_.length > 0) this.flushInputBatch_();
      }, INPUT_BATCH_FLUSH_MS);
    }
  }

  flushInputBatch_() {
    if (this.inputBatchBuf_.length === 0) return;
    const combined = Buffer.concat(this.inputBatchBuf_);
    this.inputBatchBuf_.length = 0;
    this.inputBatchBytes_ = 0;
    this.wsSend_({ type: 'input_audio_buffer.append', audio: combined.toString('base64') });
  }

  // --- WebSocket to OpenAI ------------------------------------------------

  connectWebSocket_() {
    // Node's global WebSocket (undici) accepts a non-standard `headers` option,
    // which the OpenAI Realtime API needs for bearer auth.
    this.ws_ = new WebSocket(OPENAI_REALTIME_URL, {
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    });

    this.ws_.addEventListener('open', () => {
      console.log(`[agent] WebSocket connected to OpenAI Realtime (model: ${MODEL})`);
      this.reconnectAttempts_ = 0;
      this.sendSessionUpdate_();
    });

    this.ws_.addEventListener('message', ev => {
      try {
        this.handleRealtimeEvent_(JSON.parse(ev.data.toString()));
      } catch (err) {
        console.error('[agent] WS parse error:', err.message);
      }
    });

    this.ws_.addEventListener('error', ev => {
      console.error('[agent] WS error:', ev.message || ev.error?.message || 'unknown');
    });

    this.ws_.addEventListener('close', ev => {
      console.log(`[agent] WS closed: ${ev.code} ${ev.reason || ''}`);
      if (!this.intentionalClose_) this.reconnect_();
    });
  }

  reconnect_() {
    if (this.reconnectAttempts_ >= MAX_RECONNECT_ATTEMPTS) {
      console.error('[agent] Max reconnection attempts reached; giving up.');
      return;
    }
    this.reconnectAttempts_++;
    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempts_ - 1),
      RECONNECT_CAP_MS,
    );
    console.log(
      `[agent] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts_}/${MAX_RECONNECT_ATTEMPTS})`,
    );
    setTimeout(() => this.connectWebSocket_(), delay);
  }

  sendSessionUpdate_() {
    this.wsSend_({
      type: 'session.update',
      session: {
        type: 'realtime',
        instructions: INSTRUCTIONS,
        output_modalities: ['audio'],
        audio: {
          input: {
            format: { type: 'audio/pcm', rate: OPENAI_RATE },
            transcription: { model: 'whisper-1', language: 'en' },
            turn_detection: {
              type: 'server_vad',
              silence_duration_ms: 600,
              threshold: 0.6,
              prefix_padding_ms: 300,
            },
          },
          output: {
            format: { type: 'audio/pcm', rate: OPENAI_RATE },
            voice: VOICE,
          },
        },
      },
    });
  }

  handleRealtimeEvent_(event) {
    switch (event.type) {
      case 'error':
        // Barge-in racing a finishing response makes cancel benign-fail; ignore.
        if (event.error?.code === 'response_cancel_not_active') break;
        console.error('[agent] OpenAI error:', JSON.stringify(event.error));
        break;

      case 'session.created':
        console.log('[agent] Session created');
        break;

      case 'session.updated':
        console.log('[agent] Session configured — ready. Start talking in the room.');
        // Greet on connect so the output path is exercised without waiting for VAD.
        this.wsSend_({ type: 'response.create' });
        break;

      case 'response.output_audio.delta': {
        const pcm24 = Buffer.from(event.delta, 'base64');
        this.writer_.enqueue(this.upsampler_.process(pcm24));
        break;
      }

      case 'response.output_audio_transcript.done':
        console.log(`[agent] ${event.transcript}`);
        break;

      case 'conversation.item.input_audio_transcription.completed':
        console.log(`[user]  ${event.transcript}`);
        break;

      case 'input_audio_buffer.speech_started': {
        // Barge-in: drop queued agent audio and truncate what was already heard.
        const wasSpeaking = this.currentResponseId_ !== null || this.writer_.pendingBytes() > 0;
        this.flushInputBatch_();
        this.writer_.clear();
        if (this.currentResponseId_) this.wsSend_({ type: 'response.cancel' });
        if (this.currentItemId_ && this.writer_.playedSamples() > 0) {
          this.wsSend_({
            type: 'conversation.item.truncate',
            item_id: this.currentItemId_,
            content_index: this.currentContentIdx_,
            audio_end_ms: this.writer_.playedMs(),
          });
        }
        this.currentResponseId_ = null;
        this.currentItemId_ = null;
        this.currentContentIdx_ = 0;
        this.writer_.resetPlayed();
        if (wasSpeaking) console.log('[agent] (interrupted)');
        break;
      }

      case 'response.created':
        this.currentResponseId_ = event.response?.id ?? null;
        this.writer_.resetPlayed();
        break;

      case 'response.output_item.added':
        this.currentItemId_ = event.item?.id ?? null;
        break;

      case 'response.content_part.added':
        this.currentContentIdx_ = event.content_index ?? 0;
        break;

      case 'response.done':
        this.currentResponseId_ = null;
        this.currentItemId_ = null;
        this.currentContentIdx_ = 0;
        break;
    }
  }

  wsSend_(msg) {
    if (this.ws_ && this.ws_.readyState === WebSocket.OPEN) this.ws_.send(JSON.stringify(msg));
  }

  stop() {
    this.intentionalClose_ = true;
    this.writer_.stop();
    if (this.inputBatchInterval_) clearInterval(this.inputBatchInterval_);
    if (this.ws_) this.ws_.close();
  }
}

function downmixStereo(pcm) {
  const src = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2);
  const out = new Int16Array(src.length / 2);
  for (let i = 0, j = 0; j < out.length; i += 2, j++) {
    out[j] = (src[i] + src[i + 1]) >> 1;
  }
  return Buffer.from(out.buffer, out.byteOffset, out.length * 2);
}

async function main() {
  if (!OPENAI_API_KEY) {
    console.error('Error: OPENAI_API_KEY is required (set it in .env)');
    process.exit(1);
  }
  if (typeof WebSocket === 'undefined') {
    console.error('Error: global WebSocket not found — this example requires Node.js >= 24.');
    process.exit(1);
  }

  const audioTrack = createLocalAudioTrack('voice-agent-audio');

  console.log('Connecting to room:', ROOM_NAME);
  const room = await connect(generateToken(IDENTITY, ROOM_NAME), {
    name: ROOM_NAME,
    audioTracks: [audioTrack],
    enableAutomaticSubscription: true,
  });
  console.log('Connected! Room:', room.name, 'SID:', room.sid);

  const agent = new VoiceAgent(audioTrack);
  agent.start();

  // Subscribe to the first remote audio track we see.
  let audioTrackRef = null;
  let boundAudio = false;

  // A single onFrame registration can fail to start (or can stall) with this
  // SDK, so we (re)register the sink and re-arm it a few times, plus a watchdog
  // below re-registers if frames stop arriving.
  function registerFrameSink(track) {
    track.onFrame(frame => agent.onRoomAudio(frame));
  }

  function bindAudio(track) {
    if (!track.onFrame) return;
    audioTrackRef = track;
    if (!boundAudio) {
      boundAudio = true;
      console.log('[agent] Subscribed to remote audio');
    }
    registerFrameSink(track);
    setTimeout(() => registerFrameSink(track), 1000);
    setTimeout(() => registerFrameSink(track), 3000);
  }

  function handleParticipant(participant) {
    console.log('Participant connected:', participant.identity);
    participant.on('trackSubscribed', track => {
      if (track.kind === 'audio') bindAudio(track);
    });
    for (const pub of participant.audioTracks.values()) {
      if (pub.isSubscribed && pub.track) bindAudio(pub.track);
    }
  }

  room.participants.forEach(handleParticipant);
  room.on('participantConnected', handleParticipant);

  // Watchdog: if we've received frames but they stopped for >2s, re-register.
  setInterval(() => {
    if (!audioTrackRef || agent.frameCount() === 0) return;
    if (Date.now() - agent.lastFrameAt() > 2000) {
      console.log('[agent] Audio stalled — re-registering frame sink');
      registerFrameSink(audioTrackRef);
    }
  }, 2000);

  room.on('disconnected', error => {
    console.log('Disconnected', error ? error.message : '');
    agent.stop();
    process.exit(error ? 1 : 0);
  });

  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    agent.stop();
    room.disconnect();
    setTimeout(() => process.exit(0), 1000);
  });
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
