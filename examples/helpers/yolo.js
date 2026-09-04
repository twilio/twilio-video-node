// Shared YOLOv8 pre/post-processing for the computer-vision examples.
//
// Ultralytics YOLOv8 ONNX models take a 1x3xSxS float tensor (S=640), RGB,
// values 0..1, and emit a single [1, C, N] output where N is the number of
// candidate anchors (8400 for 640x640) and the C channels are laid out as:
//   detection : 4 box (cx,cy,w,h) + numClasses scores           (C = 4 + nc)
//   pose      : 4 box + 1 score   + 17*3 keypoints (x,y,conf)   (C = 56)
// Boxes and keypoints are in letterboxed input space; the decoders map them
// back to the original image using the scale/pad recorded by letterbox().

const ort = require('onnxruntime-node');

const INPUT_SIZE = 640;
const PAD_VALUE = 114 / 255; // Ultralytics letterbox grey, normalized

// Resize RGBA into a centered SxS letterbox and produce the CHW float tensor.
// Nearest-neighbor sampling keeps this cheap enough to run inline per frame.
function letterbox(rgba, width, height, size = INPUT_SIZE) {
  const scale = Math.min(size / width, size / height);
  const newW = Math.round(width * scale);
  const newH = Math.round(height * scale);
  const padX = Math.floor((size - newW) / 2);
  const padY = Math.floor((size - newH) / 2);

  const area = size * size;
  const data = new Float32Array(3 * area);
  data.fill(PAD_VALUE); // fills all three planes with the letterbox grey

  for (let dy = 0; dy < newH; dy++) {
    const sy = Math.min(height - 1, (dy / scale) | 0);
    const outRow = (padY + dy) * size + padX;
    for (let dx = 0; dx < newW; dx++) {
      const sx = Math.min(width - 1, (dx / scale) | 0);
      const sp = (sy * width + sx) * 4;
      const o = outRow + dx;
      data[o] = rgba[sp] / 255; // R plane
      data[area + o] = rgba[sp + 1] / 255; // G plane
      data[2 * area + o] = rgba[sp + 2] / 255; // B plane
    }
  }

  const tensor = new ort.Tensor('float32', data, [1, 3, size, size]);
  return { tensor, scale, padX, padY };
}

// Map a letterboxed (cx,cy,w,h) box back to original-image pixel coordinates.
function unletterboxBox(cx, cy, w, h, scale, padX, padY) {
  return {
    x: (cx - w / 2 - padX) / scale,
    y: (cy - h / 2 - padY) / scale,
    w: w / scale,
    h: h / scale,
  };
}

function iou(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union <= 0 ? 0 : inter / union;
}

// Greedy non-max suppression. Operates within each class id independently.
function nms(boxes, iouThreshold = 0.45) {
  const kept = [];
  const byScore = boxes.slice().sort((p, q) => q.score - p.score);
  for (const box of byScore) {
    let overlap = false;
    for (const k of kept) {
      if (k.classId === box.classId && iou(box, k) > iouThreshold) {
        overlap = true;
        break;
      }
    }
    if (!overlap) kept.push(box);
  }
  return kept;
}

// Decode an object/face detection output [1, 4+nc, N]. `numClasses` is passed
// explicitly (80 for COCO, 1 for the single-class face model) so any trailing
// channels, such as face landmarks, are ignored rather than read as classes.
function decodeDetections(output, opts) {
  const { numClasses, scale, padX, padY, confThreshold = 0.35 } = opts;
  const [, , n] = output.dims;
  const d = output.data;
  const out = [];

  for (let i = 0; i < n; i++) {
    let best = 0;
    let bestClass = 0;
    for (let c = 0; c < numClasses; c++) {
      const s = d[(4 + c) * n + i];
      if (s > best) {
        best = s;
        bestClass = c;
      }
    }
    if (best < confThreshold) continue;
    const box = unletterboxBox(d[i], d[n + i], d[2 * n + i], d[3 * n + i], scale, padX, padY);
    out.push({ ...box, score: best, classId: bestClass });
  }
  return out;
}

const NUM_KEYPOINTS = 17;

// Decode a pose output [1, 56, N] into persons with a box and 17 keypoints.
function decodePose(output, opts) {
  const { scale, padX, padY, confThreshold = 0.35 } = opts;
  const [, , n] = output.dims;
  const d = output.data;
  const out = [];

  for (let i = 0; i < n; i++) {
    const score = d[4 * n + i];
    if (score < confThreshold) continue;
    const box = unletterboxBox(d[i], d[n + i], d[2 * n + i], d[3 * n + i], scale, padX, padY);
    const keypoints = [];
    for (let k = 0; k < NUM_KEYPOINTS; k++) {
      const base = (5 + k * 3) * n + i;
      keypoints.push({
        x: (d[base] - padX) / scale,
        y: (d[base + n] - padY) / scale,
        score: d[base + 2 * n],
      });
    }
    out.push({ ...box, score, classId: 0, keypoints });
  }
  return out;
}

module.exports = {
  INPUT_SIZE,
  letterbox,
  decodeDetections,
  decodePose,
  nms,
  NUM_KEYPOINTS,
};
