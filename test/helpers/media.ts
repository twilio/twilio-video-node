import type { VideoFrameInput } from '../../lib/index.js';

/**
 * Build a solid mid-grey I420 frame in the planar shape `write()` accepts, so
 * tests exercise the real publish contract rather than a hand-rolled variant.
 * Strides are tight (stride === plane width) unless `pad` is given, which lets
 * a test cover the padded-stride path.
 */
function generateI420Frame(width: number, height: number, pad = 0): VideoFrameInput {
  const uvWidth = Math.floor(width / 2);
  const uvHeight = Math.floor(height / 2);
  const yStride = width + pad;
  const uvStride = uvWidth + pad;

  const y = Buffer.alloc(yStride * height, 128);
  const u = Buffer.alloc(uvStride * uvHeight, 128);
  const v = Buffer.alloc(uvStride * uvHeight, 128);

  return {
    format: 'I420',
    width,
    height,
    y: { data: y, stride: yStride, width, height },
    u: { data: u, stride: uvStride, width: uvWidth, height: uvHeight },
    v: { data: v, stride: uvStride, width: uvWidth, height: uvHeight },
  };
}

function generateAudioSamples(frameSize: number, sampleRate = 48000, channels = 1): Buffer {
  const frequency = 440;
  const buffer = Buffer.alloc(frameSize * 2 * channels);

  for (let i = 0; i < frameSize; i++) {
    const t = i / sampleRate;
    const sample = Math.sin(2 * Math.PI * frequency * t);
    const value = Math.floor(sample * 32767);

    for (let ch = 0; ch < channels; ch++) {
      buffer.writeInt16LE(value, (i * channels + ch) * 2);
    }
  }

  return buffer;
}

export { generateI420Frame, generateAudioSamples };
