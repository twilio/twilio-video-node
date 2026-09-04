// Canvas drawing helpers for the computer-vision examples.
//
// Uses @napi-rs/canvas (prebuilt Skia binaries, no system libraries) to render
// overlays onto a frame's RGBA buffer. The flow is always: wrap the RGBA in a
// canvas, draw, then read the pixels back out for re-encoding to I420.

const { createCanvas, ImageData } = require('@napi-rs/canvas');

// The 80 COCO class names, in the order YOLOv8 detection emits them.
const COCO_CLASSES = [
  'person',
  'bicycle',
  'car',
  'motorcycle',
  'airplane',
  'bus',
  'train',
  'truck',
  'boat',
  'traffic light',
  'fire hydrant',
  'stop sign',
  'parking meter',
  'bench',
  'bird',
  'cat',
  'dog',
  'horse',
  'sheep',
  'cow',
  'elephant',
  'bear',
  'zebra',
  'giraffe',
  'backpack',
  'umbrella',
  'handbag',
  'tie',
  'suitcase',
  'frisbee',
  'skis',
  'snowboard',
  'sports ball',
  'kite',
  'baseball bat',
  'baseball glove',
  'skateboard',
  'surfboard',
  'tennis racket',
  'bottle',
  'wine glass',
  'cup',
  'fork',
  'knife',
  'spoon',
  'bowl',
  'banana',
  'apple',
  'sandwich',
  'orange',
  'broccoli',
  'carrot',
  'hot dog',
  'pizza',
  'donut',
  'cake',
  'chair',
  'couch',
  'potted plant',
  'bed',
  'dining table',
  'toilet',
  'tv',
  'laptop',
  'mouse',
  'remote',
  'keyboard',
  'cell phone',
  'microwave',
  'oven',
  'toaster',
  'sink',
  'refrigerator',
  'book',
  'clock',
  'vase',
  'scissors',
  'teddy bear',
  'hair drier',
  'toothbrush',
];

// Desaturate an RGBA buffer to grayscale in place (Rec. 601 luma). Applied
// before drawing colored overlays so the analysis stands out against a
// monochrome frame rather than reading as a plain mirror.
function desaturateRgba(rgba) {
  for (let i = 0; i < rgba.length; i += 4) {
    const luma = (rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114) | 0;
    rgba[i] = luma;
    rgba[i + 1] = luma;
    rgba[i + 2] = luma;
  }
}

// Build a drawing surface from an RGBA buffer.
function canvasFromRgba(rgba, width, height) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.putImageData(
    new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length), width, height),
    0,
    0,
  );
  return { canvas, ctx };
}

// Read the (possibly annotated) surface back into a packed RGBA Buffer.
function rgbaFromCanvas(ctx, width, height) {
  return Buffer.from(ctx.getImageData(0, 0, width, height).data.buffer);
}

function drawLabel(ctx, text, x, y, color) {
  const fontSize = 24;
  const padding = 5;
  const bandHeight = fontSize + 8;
  ctx.font = `${fontSize}px sans-serif`;
  const w = ctx.measureText(text).width + padding * 2;
  const top = Math.max(0, y - bandHeight);
  ctx.fillStyle = color;
  ctx.fillRect(x, top, w, bandHeight);
  ctx.fillStyle = '#000';
  ctx.fillText(text, x + padding, top + fontSize + 2);
}

// Draw bounding boxes with "label 0.87" captions.
function drawDetections(ctx, detections, labels) {
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#00ff88';
  for (const det of detections) {
    ctx.strokeRect(det.x, det.y, det.w, det.h);
    const name = labels ? labels[det.classId] : `#${det.classId}`;
    drawLabel(ctx, `${name} ${det.score.toFixed(2)}`, det.x, det.y, '#00ff88');
  }
}

// Draw a face box with a stack of colored label lines above it. `color` conveys
// state, e.g. green (attentive) vs orange (looking away).
function drawFaceBox(ctx, box, lines, color) {
  ctx.lineWidth = 3;
  ctx.strokeStyle = color;
  ctx.strokeRect(box.x, box.y, box.w, box.h);

  const fontSize = 22;
  const bandHeight = fontSize + 6;
  ctx.font = `${fontSize}px sans-serif`;
  let top = Math.max(0, box.y - bandHeight * lines.length);
  for (const line of lines) {
    const w = ctx.measureText(line).width + 10;
    ctx.fillStyle = color;
    ctx.fillRect(box.x, top, w, bandHeight);
    ctx.fillStyle = '#000';
    ctx.fillText(line, box.x + 5, top + fontSize);
    top += bandHeight;
  }
}

// Draw the five face keypoints (nose, eyes, ears) with the geometry the
// attention heuristic uses: the eye line (roll) and the eye-midpoint-to-nose
// line (yaw). Gives the viewer a visual read on how attention is scored.
function drawFaceKeypoints(ctx, keypoints, minScore = 0.3) {
  const [nose, le, re, lEar, rEar] = keypoints;
  const seen = p => p.score >= minScore;

  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(0, 208, 255, 0.85)';
  if (seen(le) && seen(re)) {
    ctx.beginPath();
    ctx.moveTo(le.x, le.y);
    ctx.lineTo(re.x, re.y);
    ctx.stroke();
    if (seen(nose)) {
      ctx.beginPath();
      ctx.moveTo((le.x + re.x) / 2, (le.y + re.y) / 2);
      ctx.lineTo(nose.x, nose.y);
      ctx.stroke();
    }
  }

  const dot = (p, color, r = 5) => {
    if (!seen(p)) return;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  dot(lEar, '#ff3df0');
  dot(rEar, '#ff3df0');
  dot(le, '#00d0ff');
  dot(re, '#00d0ff');
  dot(nose, '#ffcc00');
}

// Draw a status banner as a centered pill near the top of the frame, sized to
// its text so it stays visible regardless of the viewer's crop.
function drawBanner(ctx, width, text, color = 'rgba(0,0,0,0.6)') {
  const fontSize = 20;
  const padX = 14;
  const padY = 8;
  const top = 10;
  ctx.font = `${fontSize}px sans-serif`;
  const boxW = ctx.measureText(text).width + padX * 2;
  const boxH = fontSize + padY * 2;
  const left = (width - boxW) / 2;

  ctx.fillStyle = color;
  ctx.fillRect(left, top, boxW, boxH);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, left + padX, top + boxH / 2 + 1);
  ctx.textBaseline = 'alphabetic'; // reset shared canvas state
}

module.exports = {
  COCO_CLASSES,
  desaturateRgba,
  canvasFromRgba,
  rgbaFromCanvas,
  drawDetections,
  drawFaceBox,
  drawFaceKeypoints,
  drawBanner,
};
