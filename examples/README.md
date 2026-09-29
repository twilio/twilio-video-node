# Examples

Runnable examples for `@twilio/video-node-sdk`. They need a few packages the SDK itself does not depend on, and they load credentials from a `.env` file at the repo root.

## Setup

Run these from the repo root:

```bash
npm install --prefix examples
cp .env.example .env
# edit .env: set TWILIO_ACCOUNT_SID / TWILIO_API_KEY / TWILIO_API_SECRET
node examples/virtual_camera.js [room-name] [identity]
```

Each example connects with its own default identity, so they can run against one room at the same time. Pass `[identity]` to override it; two Participants sharing an identity disconnect each other.

In a repo checkout the examples use your local build when one is present, and the published `@twilio/video-node-sdk` otherwise.

`.env` is gitignored, so your real credentials are never committed.

## Examples

| Example                                            | Description                                                                                                 |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| [`virtual_camera.js`](virtual_camera.js)           | Decodes an MP4 with ffmpeg and pushes I420 frames to a room.                                                |
| [`video_mirror.js`](video_mirror.js)               | Receives remote video frames and pushes them back as-is.                                                    |
| [`audio_push.js`](audio_push.js)                   | Generates a sine wave tone and pushes PCM audio to a room.                                                  |
| [`data_channel.js`](data_channel.js)               | Two participants exchange string and binary messages via data tracks.                                       |
| [`voice_agent.js`](voice_agent.js)                 | Bridges room audio to the OpenAI Realtime API for a spoken voice agent (requires `OPENAI_API_KEY`).         |
| [`cv_object_detection.js`](cv_object_detection.js) | Runs YOLOX object detection on a participant's webcam and re-publishes the video with bounding boxes.       |
| [`cv_face_analysis.js`](cv_face_analysis.js)       | Analyzes a participant's face — presence and an attention estimate (head orientation) — drawn on the video. |

## Computer-vision examples

The computer-vision examples (`cv_*.js`) run local ONNX models via
[`onnxruntime-node`](https://www.npmjs.com/package/onnxruntime-node) and draw with
[`@napi-rs/canvas`](https://www.npmjs.com/package/@napi-rs/canvas). These two are
large and only these examples need them, so they live in `examples/package.json`
rather than the SDK's own dependencies. `npm install --prefix examples` installs them.

No cloud service or API key is needed: each example analyzes the first
participant's video and expresses its result on a re-published video track. Run
them against any room you also join from a browser, publishing your webcam.

### Downloading the models

The ONNX model files are not shipped with the repo — download the ones you need
and save them to `examples/.models/`. The examples print these same instructions
if a model is missing.

```bash
mkdir -p examples/.models

# cv_object_detection.js — YOLOX-nano (~3.7 MB)
curl -L -o examples/.models/yolox_nano.onnx \
  "https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_nano.onnx"

# cv_face_analysis.js — RTMO-t (a zip containing end2end.onnx, ~27 MB extracted)
curl -L -o examples/.models/rtmo-t.zip \
  "https://download.openmmlab.com/mmpose/v1/projects/rtmo/onnx_sdk/rtmo-t_8xb32-600e_body7-416x416-f48f75cb_20231219.zip"
unzip -j examples/.models/rtmo-t.zip '*end2end.onnx' -d examples/.models
mv examples/.models/end2end.onnx examples/.models/rtmo-t.onnx

# verify the downloads (the examples also check this on startup)
echo "c789161ed43c8269fcd4e67c67eeeb4e80c622da2eb296a20bc6007bd18a0b7d  examples/.models/yolox_nano.onnx" | shasum -a 256 -c
echo "20aad6e2e42359cac1c5b4a0b2da00e29bfe91a72a782fdcf287d273a04c1b24  examples/.models/rtmo-t.onnx"     | shasum -a 256 -c
```

Both models are **Apache-2.0** licensed and downloaded from their projects'
official channels — [YOLOX](https://github.com/Megvii-BaseDetection/YOLOX) by
Megvii and [RTMO](https://github.com/open-mmlab/mmpose/tree/main/projects/rtmo)
(OpenMMLab mmpose). Each example verifies its model's SHA-256 on startup and
refuses to run a file that doesn't match.
