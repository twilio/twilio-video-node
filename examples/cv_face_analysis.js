/**
 * Computer Vision — face analysis (presence + attention).
 *
 * A variation of cv_pose.js that analyzes the face. For the first participant's
 * webcam it reports, drawn on the re-published video (no data track):
 *   - whether a face is on screen,
 *   - an attention estimate ("Attentive" vs "Looking away"): a head-orientation
 *     heuristic from YOLOv8-pose face keypoints — turning away (yaw), head tilt
 *     (roll), or looking up/down (pitch) all read as looking away. Not true gaze
 *     tracking. The keypoints it uses (nose, eyes, ears) are drawn on the frame
 *     so the scoring is visible.
 *
 * It runs a single ONNX model (pose). Download it to examples/.models/ before
 * running (the program prints instructions if it is missing; see the README).
 * Requires Node.js >= 24, x64 (see README).
 *
 * Usage: node examples/cv_face_analysis.js [room-name]
 */

const { runCvExample } = require('./helpers/cv-runner');
const { loadModel } = require('./helpers/onnx-model');
const { letterbox, decodePose, nms } = require('./helpers/yolo');
const { rgbaToI420 } = require('./helpers/yuv');
const {
  desaturateRgba,
  canvasFromRgba,
  rgbaFromCanvas,
  drawFaceBox,
  drawFaceKeypoints,
  drawBanner,
} = require('./helpers/draw');
const {
  isFaceVisible,
  faceBoxFromKeypoints,
  estimateAttention,
} = require('./helpers/face-analysis');

const POSE_CONF = 0.4;
const ATTENTIVE = '#00ff88';
const INATTENTIVE = '#ff9500';

runCvExample({
  roomName: process.argv[2] || 'cv-face-analysis-room',
  trackName: 'cv-face-analysis',
  async createProcessor() {
    const poseModel = await loadModel('pose');
    const inputName = poseModel.inputNames[0];
    let lastLogged = 0;

    return async function process(rgba, width, height) {
      // Grayscale first: it emphasizes the analysis rather than mirroring.
      desaturateRgba(rgba);
      const { tensor, scale, padX, padY } = letterbox(rgba, width, height);
      const output = await poseModel.run({ [inputName]: tensor });
      const persons = nms(
        decodePose(output[poseModel.outputNames[0]], {
          scale,
          padX,
          padY,
          confThreshold: POSE_CONF,
        }),
      );

      const { ctx } = canvasFromRgba(rgba, width, height);

      // A face is "on screen" for any person whose face keypoints are visible.
      let primary = null;
      for (const person of persons) {
        if (!isFaceVisible(person.keypoints)) continue;
        const box = faceBoxFromKeypoints(person.keypoints);
        if (!box) continue;
        const attention = estimateAttention(person.keypoints);
        const color = attention.state === 'Attentive' ? ATTENTIVE : INATTENTIVE;
        // Show the keypoints the score is built from, then the box + label.
        drawFaceKeypoints(ctx, person.keypoints);
        drawFaceBox(ctx, box, [`${attention.state} ${attention.score}`], color);
        if (!primary || person.score > primary.person.score) primary = { person, attention };
      }

      if (primary) {
        const a = primary.attention;
        drawBanner(ctx, width, `Face: yes | ${a.state} (${a.score})`);
      } else {
        drawBanner(ctx, width, 'No face on screen');
      }

      if (Date.now() - lastLogged > 1000) {
        lastLogged = Date.now();
        const a = primary && primary.attention;
        console.log(
          primary
            ? `[cv] face: yes | attention: ${a.state} (${a.score})`
            : '[cv] face: none on screen',
        );
      }

      return rgbaToI420(rgbaFromCanvas(ctx, width, height), width, height);
    };
  },
});
