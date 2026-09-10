// I420 <-> RGBA conversion for the computer-vision examples.
//
// The SDK is I420-only: received frames arrive as three planes
// (frame.y/u/v, each { data, stride, width, height }) and LocalVideoTrack.write()
// expects a flat VideoFrameInput (y/u/v Buffers + yStride/uStride/vStride). CV
// libraries and the canvas drawing layer work in packed RGBA, so we convert in
// both directions here.
//
// Two SDK-specific details are handled:
//   - Received frames nest the planes (frame.y.data / frame.y.stride) while the
//     write() input is flat — the two shapes are bridged by i420ToRgba /
//     rgbaToI420.
//   - write() requires *even* width and height. rgbaToI420 crops the bottom row
//     and/or right column when a dimension is odd so the output is always valid.
//
// Coefficients use BT.601 studio (limited) range, matching WebRTC's decoded
// output, so a round trip (decode -> annotate -> re-encode) stays color-stable.

function clampByte(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

// I420 (planar YUV 4:2:0) -> packed RGBA. Returns a freshly allocated Buffer so
// the result stays valid after the native frame buffers are recycled.
function i420ToRgba(frame) {
  const { width, height } = frame;
  const yData = frame.y.data;
  const uData = frame.u.data;
  const vData = frame.v.data;
  const yStride = frame.y.stride;
  const uStride = frame.u.stride;
  const vStride = frame.v.stride;

  const rgba = Buffer.allocUnsafe(width * height * 4);

  for (let row = 0; row < height; row++) {
    const yRow = row * yStride;
    const cRow = (row >> 1) * uStride;
    const cRowV = (row >> 1) * vStride;
    let o = row * width * 4;

    for (let col = 0; col < width; col++) {
      const c = yData[yRow + col] - 16;
      const d = uData[cRow + (col >> 1)] - 128;
      const e = vData[cRowV + (col >> 1)] - 128;

      const y298 = 298 * c;
      rgba[o++] = clampByte((y298 + 409 * e + 128) >> 8);
      rgba[o++] = clampByte((y298 - 100 * d - 208 * e + 128) >> 8);
      rgba[o++] = clampByte((y298 + 516 * d + 128) >> 8);
      rgba[o++] = 255;
    }
  }

  return { data: rgba, width, height };
}

// Packed RGBA -> I420 VideoFrameInput ready for LocalVideoTrack.write(). Output
// dimensions are forced even (odd rows/columns are dropped). Chroma is 2x2
// box-averaged for quality.
function rgbaToI420(rgba, width, height) {
  const outW = width & ~1;
  const outH = height & ~1;
  const cW = outW >> 1;
  const cH = outH >> 1;
  const srcStride = width * 4;

  const y = Buffer.allocUnsafe(outW * outH);
  const u = Buffer.allocUnsafe(cW * cH);
  const v = Buffer.allocUnsafe(cW * cH);

  for (let row = 0; row < outH; row++) {
    const src = row * srcStride;
    const yOut = row * outW;
    for (let col = 0; col < outW; col++) {
      const p = src + col * 4;
      const r = rgba[p];
      const g = rgba[p + 1];
      const b = rgba[p + 2];
      y[yOut + col] = clampByte(((66 * r + 129 * g + 25 * b + 128) >> 8) + 16);
    }
  }

  for (let cy = 0; cy < cH; cy++) {
    const row0 = (cy << 1) * srcStride;
    const row1 = row0 + srcStride;
    const cOut = cy * cW;
    for (let cx = 0; cx < cW; cx++) {
      const p0 = row0 + (cx << 1) * 4;
      const p1 = p0 + 4;
      const p2 = row1 + (cx << 1) * 4;
      const p3 = p2 + 4;
      const r = (rgba[p0] + rgba[p1] + rgba[p2] + rgba[p3]) >> 2;
      const g = (rgba[p0 + 1] + rgba[p1 + 1] + rgba[p2 + 1] + rgba[p3 + 1]) >> 2;
      const b = (rgba[p0 + 2] + rgba[p1 + 2] + rgba[p2 + 2] + rgba[p3 + 2]) >> 2;
      u[cOut + cx] = clampByte(((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128);
      v[cOut + cx] = clampByte(((112 * r - 94 * g - 18 * b + 128) >> 8) + 128);
    }
  }

  return {
    y,
    u,
    v,
    yStride: outW,
    uStride: cW,
    vStride: cW,
    width: outW,
    height: outH,
  };
}

module.exports = { i420ToRgba, rgbaToI420 };
