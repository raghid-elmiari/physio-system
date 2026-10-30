// MediaPipe Pose Landmarker topology (33 landmarks). "left"/"right" are the PERSON's sides,
// not the screen's: in a mirrored selfie preview the person's left arm appears on the right.
//
// Everything under src/core is plain JavaScript with no DOM / browser APIs, so it can be
// reused unchanged in a Capacitor WebView or a React Native JS runtime.

export const LANDMARK = Object.freeze({
  nose: 0,
  left_eye_inner: 1,
  left_eye: 2,
  left_eye_outer: 3,
  right_eye_inner: 4,
  right_eye: 5,
  right_eye_outer: 6,
  left_ear: 7,
  right_ear: 8,
  mouth_left: 9,
  mouth_right: 10,
  left_shoulder: 11,
  right_shoulder: 12,
  left_elbow: 13,
  right_elbow: 14,
  left_wrist: 15,
  right_wrist: 16,
  left_pinky: 17,
  right_pinky: 18,
  left_index: 19,
  right_index: 20,
  left_thumb: 21,
  right_thumb: 22,
  left_hip: 23,
  right_hip: 24,
  left_knee: 25,
  right_knee: 26,
  left_ankle: 27,
  right_ankle: 28,
  left_heel: 29,
  right_heel: 30,
  left_foot_index: 31,
  right_foot_index: 32,
});

export const LANDMARK_COUNT = 33;

export const LANDMARK_NAMES = Object.freeze(
  Object.entries(LANDMARK).sort((a, b) => a[1] - b[1]).map(([name]) => name)
);

/** Skeleton edges used for drawing (same topology as PoseLandmarker.POSE_CONNECTIONS). */
export const POSE_CONNECTIONS = Object.freeze([
  [0, 1], [1, 2], [2, 3], [3, 7], [0, 4], [4, 5], [5, 6], [6, 8], [9, 10],
  [11, 12], [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19],
  [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
  [11, 23], [12, 24], [23, 24], [23, 25], [24, 26], [25, 27], [26, 28],
  [27, 29], [28, 30], [29, 31], [30, 32], [27, 31], [28, 32],
]);

/** Resolve landmark names to indices; throws on typos so exercise configs fail loudly. */
export function indicesOf(names) {
  return names.map((n) => {
    const i = LANDMARK[n];
    if (i === undefined) throw new Error(`Unknown landmark name: ${n}`);
    return i;
  });
}
