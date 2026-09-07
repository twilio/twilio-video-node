// Pre/post-processing for the computer-vision models.
//
// Both models take a 416x416 letterboxed input, BGR channel order, raw 0-255
// pixel values (no /255 normalization), NCHW. Their outputs differ:
//   - YOLOX-nano (detection): [1, A, 85] raw per-anchor predictions
//     (cx,cy,w,h, objectness, 80 class scores) that need grid/stride decoding
//     and NMS. A = 3549 for 416 (strides 8/16/32).
//   - RTMO-t (pose): two outputs, `dets` [1, N, 5] (x1,y1,x2,y2,score) and
//     `keypoints` [1, N, 17, 3] (x,y,score), already decoded and NMS'd.
// Boxes/keypoints come out in the 416 letterboxed space; the decoders map them
// back to original-image pixels using the scale/pad recorded by letterbox().

const ort = require('onnxruntime-node');

const INPUT_SIZE = 416;
const PAD_VALUE = 114; // letterbox grey, raw 0-255
const STRIDES = [8, 16, 32];

// Resize RGBA into a centered SxS letterbox and produce the BGR CHW float tensor
// the models expect (raw 0-255, no normalization). Nearest-neighbor sampling
// keeps this cheap enough to run inline per frame.
function letterbox(rgba, width, height, size = INPUT_SIZE) {
  const scale = Math.min(size / width, size / height);
  const newW = Math.round(width * scale);
  const newH = Math.round(height * scale);
  const padX = Math.floor((size - newW) / 2);
  const padY = Math.floor((size - newH) / 2);

  const area = size * size;
  const data = new Float32Array(3 * area);
  data.fill(PAD_VALUE);

  for (let dy = 0; dy < newH; dy++) {
    const sy = Math.min(height - 1, (dy / scale) | 0);
    const outRow = (padY + dy) * size + padX;
    for (let dx = 0; dx < newW; dx++) {
      const sx = Math.min(width - 1, (dx / scale) | 0);
      const sp = (sy * width + sx) * 4;
      const o = outRow + dx;
      data[o] = rgba[sp + 2]; // B plane
      data[area + o] = rgba[sp + 1]; // G plane
      data[2 * area + o] = rgba[sp]; // R plane
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

// The (gridX, gridY, stride) for each YOLOX anchor, in output order (per stride
// level, row-major). Cached per input size. Flat: [gx, gy, stride, ...].
const gridCache = new Map();
function anchorGrid(size) {
  let grid = gridCache.get(size);
  if (grid) return grid;
  grid = [];
  for (const stride of STRIDES) {
    const cells = Math.floor(size / stride);
    for (let gy = 0; gy < cells; gy++) {
      for (let gx = 0; gx < cells; gx++) grid.push(gx, gy, stride);
    }
  }
  gridCache.set(size, grid);
  return grid;
}

// Decode YOLOX detection output [1, A, 85] into boxes (pre-NMS). Each anchor is
// grid/stride decoded; the final confidence is objectness * best-class score.
function decodeYolox(output, opts) {
  const { scale, padX, padY, confThreshold = 0.35, size = INPUT_SIZE } = opts;
  const [, anchors, stride85] = output.dims; // [1, A, 85]
  const numClasses = stride85 - 5;
  const d = output.data;
  const grid = anchorGrid(size);
  const out = [];

  for (let i = 0; i < anchors; i++) {
    const base = i * stride85;
    const objectness = d[base + 4];
    if (objectness < confThreshold) continue; // cheap early reject

    let best = 0;
    let bestClass = 0;
    for (let c = 0; c < numClasses; c++) {
      const s = d[base + 5 + c];
      if (s > best) {
        best = s;
        bestClass = c;
      }
    }
    const score = objectness * best;
    if (score < confThreshold) continue;

    const gx = grid[i * 3];
    const gy = grid[i * 3 + 1];
    const st = grid[i * 3 + 2];
    const cx = (d[base] + gx) * st;
    const cy = (d[base + 1] + gy) * st;
    const w = Math.exp(d[base + 2]) * st;
    const h = Math.exp(d[base + 3]) * st;

    const box = unletterboxBox(cx, cy, w, h, scale, padX, padY);
    out.push({ ...box, score, classId: bestClass });
  }
  return out;
}

const NUM_KEYPOINTS = 17;

// Decode RTMO pose outputs into persons with a box and 17 COCO keypoints. The
// model already applies NMS, so this just thresholds by score and maps the
// letterboxed coordinates back to the original image.
function decodeRtmo(dets, keypoints, opts) {
  const { scale, padX, padY, scoreThreshold = 0.4 } = opts;
  const n = dets.dims[1]; // [1, N, 5]
  const dd = dets.data;
  const kd = keypoints.data; // [1, N, 17, 3]
  const unproject = (x, y) => ({ x: (x - padX) / scale, y: (y - padY) / scale });
  const out = [];

  for (let i = 0; i < n; i++) {
    const score = dd[i * 5 + 4];
    if (score < scoreThreshold) continue;

    const topLeft = unproject(dd[i * 5], dd[i * 5 + 1]);
    const bottomRight = unproject(dd[i * 5 + 2], dd[i * 5 + 3]);
    const box = {
      x: topLeft.x,
      y: topLeft.y,
      w: bottomRight.x - topLeft.x,
      h: bottomRight.y - topLeft.y,
    };

    const kpBase = i * NUM_KEYPOINTS * 3;
    const kpoints = [];
    for (let k = 0; k < NUM_KEYPOINTS; k++) {
      const b = kpBase + k * 3;
      const p = unproject(kd[b], kd[b + 1]);
      kpoints.push({ x: p.x, y: p.y, score: kd[b + 2] });
    }

    out.push({ ...box, score, classId: 0, keypoints: kpoints });
  }
  return out;
}

module.exports = { letterbox, decodeYolox, decodeRtmo, nms };
