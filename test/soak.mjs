#!/usr/bin/env node
/**
 * Soak test: hold a live Room with media flowing in both directions, and sample
 * resource usage throughout so a leak shows up as a trend rather than a single
 * reading.
 *
 * A standalone script rather than a vitest case: these runs are measured in
 * hours, and the point is the time series, not an assertion at the end.
 *
 * Usage:
 *   node test/soak.mjs --minutes 60 [--out soak-60m.json] [--sample 30]
 *
 * Requires TWILIO_ACCOUNT_SID / TWILIO_API_KEY / TWILIO_API_SECRET, a built
 * addon, and `npm run build:ts`.
 *
 * What it does, continuously:
 *   - Alice publishes video (640x480 @ ~15fps) and audio (48kHz mono, 10ms)
 *   - Bob subscribes and consumes both through frames()
 *   - every sample interval: RSS, heap, external, fd count, thread count,
 *     frames written/delivered/dropped
 *
 * Exit code is 0 when the run completes and no leak threshold is breached.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import twilio from 'twilio';
// The built bundle, not lib/: this runs under plain node with no TS loader.
import { connect, createLocalVideoTrack, createLocalAudioTrack } from '../dist/index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { AccessToken } = twilio.jwt;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const MINUTES = Number(arg('minutes', '60'));
const SAMPLE_SECONDS = Number(arg('sample', '30'));
/**
 * Samples inside this window are excluded from the leak analysis. WebRTC
 * allocates jitter buffers, encoder state and thread pools during start-up, so
 * early growth is expected and says nothing about a leak. Defaults to 10% of
 * the run, floored at 2 minutes.
 */
const WARMUP_MINUTES = Number(arg('warmup', String(Math.max(2, MINUTES * 0.1))));

/**
 * Which part of the pipeline to exercise. Used to localise memory growth:
 * whatever grows in `idle` is connection cost, what `publish` adds is the send
 * path, and what `full` adds on top is the receive path and frames().
 *
 *   idle    - both participants connected, no tracks published
 *   publish - Alice publishes; nobody consumes the frames
 *   full    - Alice publishes and Bob consumes through frames() (default)
 */
const MODE = arg('mode', 'full');
if (!['idle', 'publish', 'full'].includes(MODE)) {
  console.error(`--mode must be idle, publish or full; got ${MODE}`);
  process.exit(2);
}
const OUT = path.resolve(ROOT, arg('out', `soak-${MINUTES}m.json`));

const VIDEO_FPS = 15;
const AUDIO_CHUNK_MS = 10;

function token(identity, room) {
  const t = new AccessToken(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_API_KEY,
    process.env.TWILIO_API_SECRET,
    { identity, ttl: Math.max(3600, MINUTES * 60 + 600) },
  );
  const grant = new AccessToken.VideoGrant();
  grant.room = room;
  t.addGrant(grant);
  return t.toJwt();
}

/** Solid-grey I420 frame in the planar shape write() accepts. */
function i420(width, height) {
  const uvW = width / 2;
  const uvH = height / 2;
  return {
    format: 'I420',
    width,
    height,
    y: { data: Buffer.alloc(width * height, 128), stride: width, width, height },
    u: { data: Buffer.alloc(uvW * uvH, 128), stride: uvW, width: uvW, height: uvH },
    v: { data: Buffer.alloc(uvW * uvH, 128), stride: uvW, width: uvW, height: uvH },
  };
}

const pcmChunk = Buffer.alloc(960); // 480 samples of silence, 10ms at 48kHz

/** Open file descriptors for this process. Best-effort; 0 if lsof is unavailable. */
function fdCount() {
  try {
    const out = execFileSync('lsof', ['-p', String(process.pid)], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim().split('\n').length - 1;
  } catch {
    return 0;
  }
}

/** Thread count for this process. Best-effort; 0 if unavailable. */
function threadCount() {
  try {
    const out = execFileSync('ps', ['-M', String(process.pid)], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim().split('\n').length - 1;
  } catch {
    return 0;
  }
}

const log = msg => console.log(`[${new Date().toISOString()}] ${msg}`);

/**
 * Twilio disconnects participants at `MaxParticipantDuration`, which defaults
 * to 14400s (4 hours). A longer soak silently measures a dead connection from
 * that point on, so any run past the default pre-creates the room with a cap
 * that covers it. Implicitly created rooms only ever get the default.
 */
async function createRoomWithDuration(room, seconds) {
  const apiKey = process.env.TWILIO_API_KEY;
  const apiSecret = process.env.TWILIO_API_SECRET;
  const body = new URLSearchParams({
    UniqueName: room,
    Type: 'group',
    MaxParticipantDuration: String(seconds),
  });
  const res = await fetch('https://video.twilio.com/v1/Rooms', {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!res.ok) {
    throw new Error(
      `Could not pre-create room with MaxParticipantDuration=${seconds}s ` +
        `(HTTP ${res.status}): ${await res.text()}`,
    );
  }
  const created = await res.json();
  log(
    `pre-created room ${created.sid} with maxParticipantDuration=${created.max_participant_duration}s`,
  );
  return created;
}

async function main() {
  const room = `soak-${MINUTES}m-${Date.now()}`;
  log(
    `starting ${MINUTES} minute soak, mode=${MODE}, room=${room}, ` +
      `sampling every ${SAMPLE_SECONDS}s`,
  );

  const TWILIO_DEFAULT_PARTICIPANT_SECONDS = 14400;
  const needSeconds = MINUTES * 60 + 600;
  if (needSeconds > TWILIO_DEFAULT_PARTICIPANT_SECONDS) {
    await createRoomWithDuration(room, Math.min(needSeconds, 86400));
  }

  const videoTrack = createLocalVideoTrack({
    name: 'soak-cam',
    source: { type: 'raw', format: 'I420', width: 640, height: 480, fps: VIDEO_FPS },
  });
  const audioTrack = createLocalAudioTrack('soak-mic');

  const publishing = MODE !== 'idle';
  const alice = await connect(token('alice', room), {
    name: room,
    ...(publishing ? { videoTracks: [videoTrack], audioTracks: [audioTrack] } : {}),
    connectionTimeout: 30_000,
  });
  const bob = await connect(token('bob', room), { name: room, connectionTimeout: 30_000 });
  log(`connected: room=${alice.sid}`);

  // Without these the harness cannot tell a live room from a dead one: a
  // server-side disconnect leaves the publish timers running and the sample
  // line still advancing, so the run looks healthy while measuring nothing.
  let roomFailure = null;
  for (const [who, r] of [
    ['alice', alice],
    ['bob', bob],
  ]) {
    r.on('disconnected', (_room, error) => {
      const why = error ? `${error.code} ${error.message}` : 'no error supplied';
      log(`ROOM DISCONNECTED (${who}): ${why}`);
      roomFailure ??= `${who} disconnected: ${why}`;
    });
    r.on('reconnecting', error =>
      log(`ROOM RECONNECTING (${who}): ${error?.message ?? 'unknown'}`),
    );
    r.on('reconnected', () => log(`ROOM RECONNECTED (${who})`));
  }

  // Consume everything Bob subscribes to. Loops end by themselves when the
  // track is unsubscribed or the Room disconnects.
  let videoDelivered = 0;
  let audioDelivered = 0;
  const consumers = [];
  const tracks = { video: null, audio: null };

  // In 'publish' mode Bob still subscribes - that is automatic - but never
  // starts a frames() iterator, so nothing crosses into JS.
  const consuming = MODE === 'full';
  bob.on('trackSubscribed', track => {
    if (!consuming) return;
    if (track.kind === 'video') {
      tracks.video = track;
      consumers.push(
        (async () => {
          for await (const frame of track.frames({ mode: 'latest', maxQueue: 1 })) {
            videoDelivered++;
            frame.close?.();
          }
        })(),
      );
    } else if (track.kind === 'audio') {
      tracks.audio = track;
      consumers.push(
        (async () => {
          for await (const frame of track.frames({ mode: 'queue', maxQueue: 10 })) {
            audioDelivered++;
            frame.close?.();
          }
        })(),
      );
    }
  });

  // Publish at real-time cadence. A fresh frame object each tick, so any
  // retention by the SDK would show as growth.
  const videoTimer = publishing
    ? setInterval(
        () => {
          videoTrack.write(i420(640, 480));
        },
        Math.round(1000 / VIDEO_FPS),
      )
    : null;
  const audioTimer = publishing
    ? setInterval(() => {
        audioTrack.write({ pcm: pcmChunk, frames: 480 });
      }, AUDIO_CHUNK_MS)
    : null;

  const samples = [];
  const started = Date.now();
  const deadline = started + MINUTES * 60_000;

  const sample = () => {
    const mem = process.memoryUsage();
    const vw = videoTrack.getWriteStats();
    const aw = audioTrack.getWriteStats();
    const entry = {
      t: Math.round((Date.now() - started) / 1000),
      rssMB: +(mem.rss / 1048576).toFixed(2),
      heapUsedMB: +(mem.heapUsed / 1048576).toFixed(2),
      externalMB: +(mem.external / 1048576).toFixed(2),
      arrayBuffersMB: +(mem.arrayBuffers / 1048576).toFixed(2),
      fds: fdCount(),
      threads: threadCount(),
      videoWritten: vw.framesWritten,
      videoWriteDropped: vw.framesDropped,
      audioWritten: aw.framesWritten,
      audioWriteDropped: aw.framesDropped,
      videoDelivered,
      audioDelivered,
      videoRecvDropped: tracks.video?.getStats().framesDropped ?? 0,
      audioRecvDropped: tracks.audio?.getStats().framesDropped ?? 0,
    };
    samples.push(entry);
    log(
      `t=${entry.t}s rss=${entry.rssMB}MB heap=${entry.heapUsedMB}MB ext=${entry.externalMB}MB ` +
        `fds=${entry.fds} thr=${entry.threads} vTx=${entry.videoWritten} vRx=${entry.videoDelivered} ` +
        `aTx=${entry.audioWritten} aRx=${entry.audioDelivered}`,
    );
  };

  sample();
  const sampler = setInterval(sample, SAMPLE_SECONDS * 1000);

  // Poll for a disconnect rather than only waiting out the clock, so the run
  // stops at the failure instead of accumulating meaningless samples after it.
  await new Promise(resolve => {
    const tick = setInterval(() => {
      if (roomFailure || Date.now() >= deadline) {
        clearInterval(tick);
        resolve();
      }
    }, 1_000);
  });

  clearInterval(sampler);
  if (videoTimer) clearInterval(videoTimer);
  if (audioTimer) clearInterval(audioTimer);
  sample();

  log('tearing down');
  bob.disconnect();
  alice.disconnect();
  await Promise.race([Promise.all(consumers), new Promise(r => setTimeout(r, 10_000))]);
  bob.dispose();
  alice.dispose();

  // Settle, then take a final reading to see whether teardown released memory.
  await new Promise(r => setTimeout(r, 3_000));
  if (globalThis.gc) globalThis.gc();
  const after = process.memoryUsage();

  // Leak analysis runs on the post-warm-up samples only. Two views of the same
  // data: half-over-half for a coarse read, and a least-squares slope in MB per
  // hour, which is the number that actually matters for a long-lived server.
  const warmupSeconds = WARMUP_MINUTES * 60;
  const steady = samples.filter(s => s.t >= warmupSeconds);
  const analysed = steady.length >= 4 ? steady : samples;

  const avg = (arr, key) => arr.reduce((s, x) => s + x[key], 0) / (arr.length || 1);
  const mid = Math.floor(analysed.length / 2);
  const firstHalfRss = avg(analysed.slice(0, mid), 'rssMB');
  const secondHalfRss = avg(analysed.slice(mid), 'rssMB');
  const rssGrowthPct = firstHalfRss ? ((secondHalfRss - firstHalfRss) / firstHalfRss) * 100 : 0;

  /** Least-squares slope of `key` against time, converted to units per hour. */
  const slopePerHour = (arr, key) => {
    const n = arr.length;
    if (n < 2) return 0;
    const meanT = avg(arr, 't');
    const meanY = avg(arr, key);
    let num = 0;
    let den = 0;
    for (const s of arr) {
      num += (s.t - meanT) * (s[key] - meanY);
      den += (s.t - meanT) ** 2;
    }
    return den ? (num / den) * 3600 : 0;
  };
  const rssSlopeMBPerHour = slopePerHour(analysed, 'rssMB');
  const heapSlopeMBPerHour = slopePerHour(analysed, 'heapUsedMB');

  // A slope fitted over a few minutes is dominated by start-up and says
  // nothing about a leak, however confident the number looks. Below this span
  // the trend is reported but never treated as a finding.
  const MIN_TREND_MINUTES = 10;
  const analysedSpanMinutes =
    analysed.length >= 2 ? (analysed[analysed.length - 1].t - analysed[0].t) / 60 : 0;
  const trendIsMeaningful = steady.length >= 4 && analysedSpanMinutes >= MIN_TREND_MINUTES;

  const summary = {
    mode: MODE,
    minutes: MINUTES,
    sampleSeconds: SAMPLE_SECONDS,
    samples: samples.length,
    rssStartMB: samples[0].rssMB,
    rssEndMB: samples[samples.length - 1].rssMB,
    rssPeakMB: Math.max(...samples.map(s => s.rssMB)),
    rssAfterTeardownMB: +(after.rss / 1048576).toFixed(2),
    warmupMinutes: WARMUP_MINUTES,
    analysedSamples: analysed.length,
    firstHalfAvgRssMB: +firstHalfRss.toFixed(2),
    secondHalfAvgRssMB: +secondHalfRss.toFixed(2),
    rssGrowthPct: +rssGrowthPct.toFixed(2),
    analysedSpanMinutes: +analysedSpanMinutes.toFixed(1),
    trendIsMeaningful,
    rssSlopeMBPerHour: +rssSlopeMBPerHour.toFixed(2),
    heapSlopeMBPerHour: +heapSlopeMBPerHour.toFixed(2),
    fdStart: samples[0].fds,
    fdEnd: samples[samples.length - 1].fds,
    threadStart: samples[0].threads,
    threadEnd: samples[samples.length - 1].threads,
    videoWritten: samples[samples.length - 1].videoWritten,
    videoDelivered: samples[samples.length - 1].videoDelivered,
    audioWritten: samples[samples.length - 1].audioWritten,
    audioDelivered: samples[samples.length - 1].audioDelivered,
    videoWriteDropped: samples[samples.length - 1].videoWriteDropped,
    audioWriteDropped: samples[samples.length - 1].audioWriteDropped,
  };

  fs.writeFileSync(OUT, JSON.stringify({ summary, samples }, null, 2));
  log(`wrote ${OUT}`);
  log(JSON.stringify(summary, null, 2));

  // Thresholds are deliberately loose: this flags a trend worth investigating,
  // it does not certify the absence of a leak.
  const problems = [];
  if (!trendIsMeaningful) {
    log(
      `NOTE: the analysed window spans ${analysedSpanMinutes.toFixed(1)} minutes over ` +
        `${steady.length} samples, below the ${MIN_TREND_MINUTES}-minute minimum for a trend. ` +
        `RSS slope ${rssSlopeMBPerHour.toFixed(1)} MB/h is reported for reference only and is ` +
        'not treated as a leak signal.',
    );
  }
  if (steady.length < 4) {
    log(
      `NOTE: only ${steady.length} samples fell outside the ${WARMUP_MINUTES}-minute warm-up window, ` +
        'so the trend below is dominated by start-up allocation and should not be read as a leak signal.',
    );
  }
  // A long-lived server is the target, so the slope is the meaningful check;
  // the half-over-half figure is kept as a sanity cross-check.
  if (trendIsMeaningful && rssSlopeMBPerHour > 20) {
    problems.push(`RSS trending +${rssSlopeMBPerHour.toFixed(1)} MB/hour after warm-up`);
  }
  if (trendIsMeaningful && rssGrowthPct > 15) {
    problems.push(`RSS grew ${rssGrowthPct.toFixed(1)}% between halves of the steady-state window`);
  }
  if (summary.fdEnd > summary.fdStart * 1.5 && summary.fdEnd - summary.fdStart > 20) {
    problems.push(`fd count rose ${summary.fdStart} -> ${summary.fdEnd}`);
  }
  if (summary.threadEnd > summary.threadStart + 10) {
    problems.push(`thread count rose ${summary.threadStart} -> ${summary.threadEnd}`);
  }
  if (roomFailure) {
    log(`SOAK ABORTED: ${roomFailure}. Samples up to the disconnect are in ${OUT}.`);
    process.exitCode = 1;
    return;
  }
  if (MODE === 'full' && summary.videoDelivered === 0) {
    problems.push('no video frames were received');
  }
  if (MODE === 'full' && summary.audioDelivered === 0) {
    problems.push('no audio frames were received');
  }
  if (publishing && summary.videoWritten === 0) problems.push('no video frames were written');

  if (problems.length) {
    log(`SOAK FINDINGS: ${problems.join('; ')}`);
    process.exit(1);
  }
  const mediaNote =
    MODE === 'full'
      ? 'media flowed throughout'
      : MODE === 'publish'
        ? 'publish ran throughout, nothing consumed'
        : 'idle: connected with no media';
  log(`SOAK OK (${MODE}): no leak threshold breached, ${mediaNote}`);
  process.exit(0);
}

main().catch(err => {
  log(`SOAK FAILED: ${err?.stack || err}`);
  process.exit(2);
});
