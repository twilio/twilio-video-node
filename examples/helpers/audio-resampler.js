// 48kHz <-> 24kHz resampling with FIR anti-alias filtering.
//
// The naive approach — averaging adjacent samples (downsample) and linear
// interpolation (upsample) — introduces aliasing artifacts audible as
// distortion. This version applies a 31-tap Hamming-windowed sinc low-pass
// filter at 12 kHz (Nyquist of the 24 kHz rate) before decimation and after
// zero-stuffing, eliminating aliasing.
//
// Both resamplers are stateful: they keep a delay-line across calls so that
// frame boundaries (typically every 10 ms / 480 samples) don't produce clicks.

const TAPS = 31;
const FC = 0.25; // cutoff = 12 kHz / 48 kHz

const COEFFS = (() => {
  const M = (TAPS - 1) / 2;
  const h = new Float64Array(TAPS);
  let sum = 0;
  for (let n = 0; n < TAPS; n++) {
    const x = n - M;
    const sinc = x === 0 ? 2 * FC : Math.sin(2 * Math.PI * FC * x) / (Math.PI * x);
    const win = 0.54 - 0.46 * Math.cos((2 * Math.PI * n) / (TAPS - 1));
    h[n] = sinc * win;
    sum += h[n];
  }
  for (let n = 0; n < TAPS; n++) h[n] /= sum;
  return h;
})();

function clamp16(v) {
  if (v > 32767) return 32767;
  if (v < -32768) return -32768;
  return (v + (v > 0 ? 0.5 : -0.5)) | 0;
}

// --- Downsampler: 48 kHz → 24 kHz -------------------------------------------
// Filter at 48 kHz rate, then keep every 2nd sample.

function createDownsampler() {
  const delay = new Float64Array(TAPS);
  let pos = 0;

  function process(buf) {
    const src = new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
    const dst = new Int16Array(Math.ceil(src.length / 2));
    let outIdx = 0;

    for (let i = 0; i < src.length; i++) {
      delay[pos] = src[i];
      pos = (pos + 1) % TAPS;

      if (i % 2 === 0) {
        let acc = 0;
        for (let k = 0, di = pos; di < TAPS; k++, di++) {
          acc += delay[di] * COEFFS[k];
        }
        for (let k = TAPS - pos, di = 0; di < pos; k++, di++) {
          acc += delay[di] * COEFFS[k];
        }
        dst[outIdx++] = clamp16(acc);
      }
    }

    return Buffer.from(dst.buffer, dst.byteOffset, outIdx * 2);
  }

  function reset() {
    delay.fill(0);
    pos = 0;
  }

  return { process, reset };
}

// --- Upsampler: 24 kHz → 48 kHz ---------------------------------------------
// Polyphase implementation: split COEFFS into even/odd phases so we operate at
// the input rate (24 kHz) instead of inserting zeros and filtering at 48 kHz.

function createUpsampler() {
  const EVEN_LEN = Math.ceil(TAPS / 2);
  const ODD_LEN = Math.floor(TAPS / 2);
  const evenPhase = new Float64Array(EVEN_LEN);
  const oddPhase = new Float64Array(ODD_LEN);
  for (let k = 0; k < TAPS; k++) {
    if (k % 2 === 0) evenPhase[k >> 1] = COEFFS[k];
    else oddPhase[k >> 1] = COEFFS[k];
  }

  const DELAY_LEN = EVEN_LEN;
  const DELAY_MASK = DELAY_LEN - 1; // DELAY_LEN is power of 2
  const delay = new Float64Array(DELAY_LEN);
  let pos = 0;

  function process(buf) {
    const src = new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
    const dst = new Int16Array(src.length * 2);

    for (let i = 0; i < src.length; i++) {
      delay[pos] = src[i];
      pos = (pos + 1) & DELAY_MASK;

      let acc0 = 0;
      for (let j = 0; j < EVEN_LEN; j++) {
        acc0 += delay[(pos + j) & DELAY_MASK] * evenPhase[j];
      }
      dst[i * 2] = clamp16(acc0 * 2);

      let acc1 = 0;
      for (let j = 0; j < ODD_LEN; j++) {
        acc1 += delay[(pos + j) & DELAY_MASK] * oddPhase[j];
      }
      dst[i * 2 + 1] = clamp16(acc1 * 2);
    }

    return Buffer.from(dst.buffer, dst.byteOffset, src.length * 4);
  }

  function reset() {
    delay.fill(0);
    pos = 0;
  }

  return { process, reset };
}

module.exports = { createDownsampler, createUpsampler };
