/**
 * Computer Vision — object detection.
 *
 * Joins a room, runs YOLOX-nano on the first participant's webcam, and
 * re-publishes the video with bounding boxes + labels drawn on it (person,
 * laptop, cell phone, cup, ...). Results are shown on the video track only — no
 * data track — so it works against any room you join from a browser.
 *
 * Download the YOLOX-nano ONNX model to examples/.models/ before running (the
 * program prints instructions if it is missing; see the README). Requires
 * Node.js >= 24, x64 (see README).
 *
 * Usage: node examples/cv_object_detection.js [room-name]
 */

const { runCvExample } = require('./helpers/cv-runner');
const { loadModel, runModel } = require('./helpers/onnx-model');
const { letterbox, decodeYolox, nms } = require('./helpers/yolo');
const { rgbaToI420 } = require('./helpers/yuv');
const {
  desaturateRgba,
  canvasFromRgba,
  rgbaFromCanvas,
  drawDetections,
  COCO_CLASSES,
} = require('./helpers/draw');

const CONF_THRESHOLD = 0.35;

runCvExample({
  roomName: process.argv[2] || 'cv-detection-room',
  trackName: 'cv-detection',
  async createProcessor() {
    const session = await loadModel('detection');
    let lastLogged = 0;

    return async function process(rgba, width, height) {
      const { tensor, scale, padX, padY } = letterbox(rgba, width, height);
      const output = await runModel(session, tensor);

      const detections = nms(
        decodeYolox(output, { scale, padX, padY, confThreshold: CONF_THRESHOLD }),
      );

      // Log a rolling summary about once a second.
      if (Date.now() - lastLogged > 1000) {
        lastLogged = Date.now();
        const counts = {};
        for (const d of detections) {
          const name = COCO_CLASSES[d.classId];
          counts[name] = (counts[name] || 0) + 1;
        }
        const summary = Object.entries(counts)
          .map(([k, v]) => `${v} ${k}`)
          .join(', ');
        console.log(`[cv] ${summary || 'nothing detected'}`);
      }

      // Grayscale the frame, then draw colored boxes on top so the analysis
      // stands out rather than reading as a plain mirror.
      desaturateRgba(rgba);
      const ctx = canvasFromRgba(rgba, width, height);
      drawDetections(ctx, detections, COCO_CLASSES);
      return rgbaToI420(rgbaFromCanvas(ctx, width, height), width, height);
    };
  },
});
