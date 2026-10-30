"""
Wraps MediaPipe Pose to turn a single BGR frame into a normalized keypoint dict.

This is the component that closes the gap flagged repeatedly in this project's earlier
analysis: the source paper names MediaPipe Pose but never pins a model tier or documents
a confidence-thresholding strategy. Both are made explicit and configurable here.
"""
from dataclasses import dataclass, field
from typing import Dict, List, Optional

import numpy as np

try:
    import mediapipe as mp
except ImportError as exc:  # pragma: no cover - exercised only when the dependency is missing
    raise ImportError(
        "mediapipe is required. Install with: pip install -r requirements.txt"
    ) from exc


# MediaPipe Pose's 33 landmark names, in index order — used to make keypoint dicts
# human-readable (e.g. "left_elbow") instead of bare integer indices, which the
# comparator and feedback engine both key off of.
LANDMARK_NAMES = [
    "nose", "left_eye_inner", "left_eye", "left_eye_outer", "right_eye_inner",
    "right_eye", "right_eye_outer", "left_ear", "right_ear", "mouth_left",
    "mouth_right", "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
    "left_wrist", "right_wrist", "left_pinky", "right_pinky", "left_index",
    "right_index", "left_thumb", "right_thumb", "left_hip", "right_hip",
    "left_knee", "right_knee", "left_ankle", "right_ankle", "left_heel",
    "right_heel", "left_foot_index", "right_foot_index",
]


@dataclass
class Keypoint:
    x: float
    y: float
    z: float
    visibility: float


@dataclass
class PoseResult:
    keypoints: Dict[str, Keypoint] = field(default_factory=dict)
    detected: bool = False


class PoseEstimator:
    """
    model_complexity: 0 (lite) / 1 (full) / 2 (heavy) — MediaPipe's own tiers.
    Pinned explicitly here (default: 1, "full") rather than left ambiguous, per the
    earlier gap analysis of the source paper.
    """

    def __init__(self, model_complexity: int = 1, min_detection_confidence: float = 0.5,
                 min_tracking_confidence: float = 0.5, min_visibility: float = 0.5):
        self._mp_pose = mp.solutions.pose
        self._pose = self._mp_pose.Pose(
            static_image_mode=False,
            model_complexity=model_complexity,
            min_detection_confidence=min_detection_confidence,
            min_tracking_confidence=min_tracking_confidence,
        )
        self.min_visibility = min_visibility

    def process(self, bgr_frame: np.ndarray) -> PoseResult:
        rgb = bgr_frame[:, :, ::-1]  # MediaPipe expects RGB, OpenCV gives BGR
        results = self._pose.process(rgb)

        if not results.pose_landmarks:
            return PoseResult(detected=False)

        keypoints: Dict[str, Keypoint] = {}
        for name, lm in zip(LANDMARK_NAMES, results.pose_landmarks.landmark):
            # Confidence-score thresholding: low-visibility landmarks are dropped rather
            # than fed into the comparator as if they were reliable — closes the gap
            # flagged in the earlier "What Should NOT Do" analysis of the source paper.
            if lm.visibility >= self.min_visibility:
                keypoints[name] = Keypoint(x=lm.x, y=lm.y, z=lm.z, visibility=lm.visibility)

        return PoseResult(keypoints=keypoints, detected=len(keypoints) > 0)

    def close(self):
        self._pose.close()
