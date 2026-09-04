// Face-analysis helpers for cv_face_analysis.js: a face-presence check, a face
// box, and a head-orientation attention heuristic — all derived from the five
// face keypoints (nose, eyes, ears) that YOLOv8-pose emits per person.

// COCO pose keypoint indices for the face.
const KP = { nose: 0, leftEye: 1, rightEye: 2, leftEar: 3, rightEar: 4 };

// A face is considered on screen when the nose, or both eyes, are visible.
function isFaceVisible(keypoints, minScore = 0.3) {
  const seen = i => keypoints[i].score >= minScore;
  return seen(KP.nose) || (seen(KP.leftEye) && seen(KP.rightEye));
}

// Build an approximate head box from the visible face keypoints, padded up for
// the forehead and down for the chin (the keypoints only span eyes-to-ears).
function faceBoxFromKeypoints(keypoints, minScore = 0.3) {
  const pts = [KP.nose, KP.leftEye, KP.rightEye, KP.leftEar, KP.rightEar]
    .map(i => keypoints[i])
    .filter(p => p.score >= minScore);
  if (pts.length < 2) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const w = maxX - minX;
  const h = maxY - minY;
  const padX = w * 0.35 + 10;
  const padTop = h * 1.2 + 12; // forehead sits above the eyes
  const padBottom = h * 1.6 + 12; // chin sits below the nose
  return {
    x: minX - padX,
    y: minY - padTop,
    w: w + 2 * padX,
    h: h + padTop + padBottom,
  };
}

// Neutral (looking straight at the camera) reference values, in eye-widths, for
// the pitch heuristic. Uncalibrated averages — tune per your camera if needed.
const NEUTRAL_NOSE_DROP = 0.62; // nose tip below the eye line
const NEUTRAL_EAR_OFFSET = 0.1; // ears below the eye line
const PITCH_DOWN = -0.22; // p below this reads as looking down
const PITCH_UP = 0.3; // p above this reads as looking up

// Estimate attention from the five face keypoints. This is a geometric
// head-orientation heuristic (is the head facing the camera), not true gaze
// tracking. It scores how frontal the head is from ear visibility, the nose's
// horizontal offset within the eyes (yaw), the tilt of the eye line (roll), and
// a coarse up/down estimate (pitch). A strong turn or up/down tilt reads as
// "Looking away". Returns { state, score }.
function estimateAttention(keypoints, minScore = 0.3) {
  const nose = keypoints[KP.nose];
  const le = keypoints[KP.leftEye];
  const re = keypoints[KP.rightEye];
  const lEar = keypoints[KP.leftEar];
  const rEar = keypoints[KP.rightEar];
  const seen = p => p.score >= minScore;

  let score = 100;
  let pitchAway = false;

  // Ear visibility: one ear hidden means the head is turned to that side; both
  // hidden is ambiguous but usually not frontal.
  if (seen(lEar) !== seen(rEar)) score -= 45;
  else if (!seen(lEar) && !seen(rEar)) score -= 25;

  if (seen(le) && seen(re)) {
    const eyeMidX = (le.x + re.x) / 2;
    const eyeMidY = (le.y + re.y) / 2;
    const eyeDist = Math.hypot(le.x - re.x, le.y - re.y) || 1;

    // Yaw: how far the nose sits from the eye midline, measured in eye-widths.
    const yaw = seen(nose) ? Math.abs(nose.x - eyeMidX) / eyeDist : 1;
    score -= Math.min(50, yaw * 80);

    // Roll: tilt of the line between the eyes, in radians.
    const roll = Math.abs(Math.atan2(re.y - le.y, re.x - le.x));
    score -= Math.min(20, roll * 40);

    // Pitch (coarse up/down): the nose foreshortens toward the eyes when looking
    // down and drops away when looking up; the ears mirror this against the eye
    // line. Both cues are normalized by eye spacing and offset from neutral. A
    // strong tilt counts the same as looking away.
    if (seen(nose)) {
      let pitch = (nose.y - eyeMidY) / eyeDist - NEUTRAL_NOSE_DROP;
      if (seen(lEar) && seen(rEar)) {
        const earOffset = (lEar.y + rEar.y) / 2 - eyeMidY;
        pitch = (pitch + (earOffset / eyeDist - NEUTRAL_EAR_OFFSET)) / 2;
      }
      if (pitch < PITCH_DOWN || pitch > PITCH_UP) {
        pitchAway = true;
        score -= 40;
      }
    }
  } else {
    score -= 40; // can't see both eyes -> not facing forward
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { state: score >= 60 && !pitchAway ? 'Attentive' : 'Looking away', score };
}

module.exports = {
  KP,
  isFaceVisible,
  faceBoxFromKeypoints,
  estimateAttention,
};
