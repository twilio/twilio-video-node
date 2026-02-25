function generateI420Frame(width, height) {
  const ySize = width * height;
  const uvWidth = Math.floor(width / 2);
  const uvHeight = Math.floor(height / 2);
  const uvSize = uvWidth * uvHeight;

  const y = Buffer.alloc(ySize);
  const u = Buffer.alloc(uvSize);
  const v = Buffer.alloc(uvSize);

  y.fill(128);
  u.fill(128);
  v.fill(128);

  return { y, u, v };
}

function generateAudioSamples(frameSize, sampleRate = 48000, channels = 1) {
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
