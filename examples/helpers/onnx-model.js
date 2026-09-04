// ONNX model loader for the computer-vision examples.
//
// The model files are not shipped with the repo. Each developer downloads them
// themselves (see the "Downloading the models" section of the README) and places
// them in examples/.models/ (gitignored). This loader resolves a model to an
// ort.InferenceSession; if the file is missing it prints where to download it
// and how, then exits.

const fs = require('fs');
const path = require('path');
const ort = require('onnxruntime-node');

const CACHE_DIR = path.join(__dirname, '..', '.models');

// Standard Ultralytics YOLOv8 ONNX exports (640x640 input). `url` is the
// suggested download source, surfaced in the instructions below; it is not
// fetched automatically. These are third-party community mirrors — swap in your
// own source if you prefer.
const MODELS = {
  detection: {
    name: 'YOLOv8n object detection (COCO)',
    file: 'yolov8n.onnx',
    url: 'https://raw.githubusercontent.com/Hyuto/yolov8-onnxruntime-web/fc4a52c466d15ad4519873a0cef22fbc935b93b6/public/model/yolov8n.onnx',
  },
  pose: {
    name: 'YOLOv8n pose',
    file: 'yolov8n-pose.onnx',
    url: 'https://raw.githubusercontent.com/akbartus/Yolov8-Pose-Detection-on-Browser/4e063a36ad14d3a0e1da153a6f547219416fcae9/yolov8_pose_onnx/model/yolov8n-pose.onnx',
  },
};

// Cap ONNX Runtime's intra-op thread pool. By default it uses one thread per
// core and can saturate the CPU (especially under Rosetta on Apple Silicon).
// Override with CV_THREADS.
const THREADS = Math.max(1, Number(process.env.CV_THREADS) || 2);

function missingModelInstructions(spec, dest) {
  return [
    '',
    `[model] Required model not found: ${spec.name}`,
    `        Expected at: ${dest}`,
    '',
    '        Download it, then save it to that path. For example:',
    `          mkdir -p ${CACHE_DIR}`,
    `          curl -L -o ${dest} \\`,
    `            "${spec.url}"`,
    '',
    '        See the README\'s "Downloading the models" section for all models.',
    '',
  ].join('\n');
}

// Resolve a model to an ort.InferenceSession. Exits with instructions if the
// file has not been downloaded yet.
async function loadModel(key) {
  const spec = MODELS[key];
  if (!spec) throw new Error(`Unknown model '${key}'`);

  const dest = path.join(CACHE_DIR, spec.file);
  if (!fs.existsSync(dest)) {
    console.error(missingModelInstructions(spec, dest));
    process.exit(1);
  }

  console.log(`[model] Loading ${spec.file} (${THREADS} thread${THREADS === 1 ? '' : 's'})`);
  return ort.InferenceSession.create(dest, {
    intraOpNumThreads: THREADS,
    interOpNumThreads: 1,
  });
}

module.exports = { loadModel, MODELS, CACHE_DIR };
