"""
Implements the paper's own described comparison method: joint angles and inter-landmark
distances (NumPy), compared between the live pose and a reference pose, producing a
deviation score and a specific (not generic) corrective message.

The paper never documents its actual angle formula or match threshold — this module
picks and DOCUMENTS one concrete, defensible implementation rather than leaving it
ambiguous, per the earlier gap analysis.
"""
from dataclasses import dataclass
from typing import Dict, List, Optional

import numpy as np

from pose_estimator import Keypoint

# Which three-point angles matter for posture feedback, and the human-readable joint
# name each one is reported under. Add/remove per-exercise as needed — this list is
# deliberately small and explicit rather than "compare everything."
ANGLE_TRIPLETS = {
    "left_elbow": ("left_shoulder", "left_elbow", "left_wrist"),
    "right_elbow": ("right_shoulder", "right_elbow", "right_wrist"),
    "left_knee": ("left_hip", "left_knee", "left_ankle"),
    "right_knee": ("right_hip", "right_knee", "right_ankle"),
    "left_shoulder": ("left_elbow", "left_shoulder", "left_hip"),
    "right_shoulder": ("right_elbow", "right_shoulder", "right_hip"),
}

# Degrees of allowed deviation before a joint is flagged. Configurable per exercise in
# a real deployment (see exercises table's potential for a per-exercise threshold column);
# a single global default is used here for the MVP and documented as such.
DEFAULT_DEVIATION_THRESHOLD_DEGREES = 15.0


@dataclass
class JointDeviation:
    joint_name: str
    deviation_degrees: float
    feedback_message: Optional[str]


def _angle_degrees(a: Keypoint, b: Keypoint, c: Keypoint) -> float:
    """Angle at point b, formed by rays b->a and b->c, in degrees."""
    ba = np.array([a.x - b.x, a.y - b.y])
    bc = np.array([c.x - b.x, c.y - b.y])
    denom = (np.linalg.norm(ba) * np.linalg.norm(bc))
    if denom == 0:
        return 0.0
    cosine = np.clip(np.dot(ba, bc) / denom, -1.0, 1.0)
    return float(np.degrees(np.arccos(cosine)))


def compute_angles(keypoints: Dict[str, Keypoint]) -> Dict[str, float]:
    angles = {}
    for joint_name, (p1, p2, p3) in ANGLE_TRIPLETS.items():
        if p1 in keypoints and p2 in keypoints and p3 in keypoints:
            angles[joint_name] = _angle_degrees(keypoints[p1], keypoints[p2], keypoints[p3])
    return angles


def compare_to_reference(
    live_keypoints: Dict[str, Keypoint],
    reference_angles: Dict[str, float],
    threshold_degrees: float = DEFAULT_DEVIATION_THRESHOLD_DEGREES,
) -> List[JointDeviation]:
    """
    Returns one JointDeviation per joint that could be evaluated, with a specific,
    joint-named feedback message when the deviation exceeds the threshold — matching
    the paper's own stated design goal (specific cues like "Raise Left Hand", not
    generic "wrong posture" messages).
    """
    live_angles = compute_angles(live_keypoints)
    results: List[JointDeviation] = []

    for joint_name, ref_angle in reference_angles.items():
        if joint_name not in live_angles:
            continue  # joint not visible/confident enough this frame — skip, don't guess
        deviation = abs(live_angles[joint_name] - ref_angle)
        message = None
        if deviation > threshold_degrees:
            message = _feedback_message(joint_name, live_angles[joint_name], ref_angle)
        results.append(JointDeviation(joint_name=joint_name, deviation_degrees=deviation, feedback_message=message))

    return results


def _feedback_message(joint_name: str, live_angle: float, ref_angle: float) -> str:
    """
    Produces a specific, actionable cue. This mapping is intentionally simple and
    editable — a real deployment should have these reviewed by a physiotherapist per
    exercise, per the recommendation in the earlier feasibility analysis.
    """
    direction = "extend" if live_angle < ref_angle else "bend"
    joint_label = joint_name.replace("_", " ").title()
    return f"{direction.capitalize()} your {joint_label}"
