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

// Both models are permissively licensed (Apache-2.0) and hosted on their
// projects' own official channels. `url` is the suggested download source,
// surfaced in the instructions below; it is not fetched automatically. RTMO is
// distributed as a zip, so `zipEntry` names the .onnx to extract from it.
const MODELS = {
  detection: {
    name: 'YOLOX-nano object detection, COCO (Apache-2.0)',
    file: 'yolox_nano.onnx',
    url: 'https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_nano.onnx',
  },
  pose: {
    name: 'RTMO-t pose, COCO keypoints (Apache-2.0)',
    file: 'rtmo-t.onnx',
    url: 'https://download.openmmlab.com/mmpose/v1/projects/rtmo/onnx_sdk/rtmo-t_8xb32-600e_body7-416x416-f48f75cb_20231219.zip',
    zipEntry: 'end2end.onnx',
  },
};

// Cap ONNX Runtime's intra-op thread pool. By default it uses one thread per
// core and can saturate the CPU (especially under Rosetta on Apple Silicon).
// Override with CV_THREADS.
const THREADS = Math.max(1, Number(process.env.CV_THREADS) || 2);

function missingModelInstructions(spec, dest) {
  const lines = [
    '',
    `[model] Required model not found: ${spec.name}`,
    `        Expected at: ${dest}`,
    '',
    '        Download it, then save it to that path. For example:',
    `          mkdir -p ${CACHE_DIR}`,
  ];
  if (spec.zipEntry) {
    const zip = `${dest}.zip`;
    lines.push(
      `          curl -L -o ${zip} \\`,
      `            "${spec.url}"`,
      `          unzip -j ${zip} '*${spec.zipEntry}' -d ${CACHE_DIR}`,
      `          mv ${path.join(CACHE_DIR, spec.zipEntry)} ${dest}`,
    );
  } else {
    lines.push(`          curl -L -o ${dest} \\`, `            "${spec.url}"`);
  }
  lines.push('', '        See the README\'s "Downloading the models" section for all models.', '');
  return lines.join('\n');
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

// Run a session on a single input tensor and return its single output tensor,
// hiding ONNX Runtime's input/output-name bookkeeping.
async function runModel(session, tensor) {
  const output = await session.run({ [session.inputNames[0]]: tensor });
  return output[session.outputNames[0]];
}

// Run a session and return all output tensors keyed by name — for models with
// more than one output (e.g. RTMO's `dets` + `keypoints`).
async function runModelOutputs(session, tensor) {
  return session.run({ [session.inputNames[0]]: tensor });
}

module.exports = { loadModel, runModel, runModelOutputs };
