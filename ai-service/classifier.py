"""
The paper's Section IV classifier: a small feed-forward TensorFlow network over a
flattened (x, y) keypoint vector, classifying exercise-vs-non-exercise motion.

Per the resolution documented in the redesign spec, this is wired in as a SECONDARY
validation signal (logged with source='CLASSIFIER'), not the primary driver of live
feedback — the primary loop is the geometric comparator in comparator.py, matching the
paper's own Section III methodology narrative.

NOTE: this file defines the architecture and a build_model()/train() entry point
matching the paper's stated training method (90/10 split, one-hot labels, Adam
optimizer, binary cross-entropy). It does NOT ship a pretrained weights file — the
paper never published its dataset or weights, so a real deployment must train this
on its own labeled data before use. Calling predict() before training/loading
weights will raise, deliberately, rather than silently returning meaningless output.
"""
from typing import Dict, Optional

import numpy as np

try:
    import tensorflow as tf
    from tensorflow.keras import layers, models
except ImportError as exc:  # pragma: no cover
    raise ImportError(
        "tensorflow is required. Install with: pip install -r requirements.txt"
    ) from exc

from pose_estimator import LANDMARK_NAMES, Keypoint

INPUT_DIM = len(LANDMARK_NAMES) * 2  # 33 keypoints * (x, y) = 66 — the paper describes 17 points (34-dim);
# this MVP uses MediaPipe Pose's full 33-point output instead, since that's what
# pose_estimator.py actually extracts. If reproducing the paper's exact 17-point input
# is required, select a fixed subset of LANDMARK_NAMES before flattening.


def build_model(input_dim: int = INPUT_DIM) -> "tf.keras.Model":
    """Matches the paper's stated architecture: dense layers, ReLU, dropout, sigmoid output."""
    model = models.Sequential([
        layers.Input(shape=(input_dim,)),
        layers.Dense(64, activation="relu"),
        layers.Dropout(0.3),
        layers.Dense(32, activation="relu"),
        layers.Dropout(0.3),
        layers.Dense(1, activation="sigmoid"),
    ])
    model.compile(optimizer="adam", loss="binary_crossentropy", metrics=["accuracy"])
    return model


def keypoints_to_vector(keypoints: Dict[str, Keypoint]) -> np.ndarray:
    """Flattens keypoints into the fixed-order (x, y) vector the model expects.
    Missing/low-confidence landmarks (dropped by PoseEstimator's visibility filter)
    are zero-filled rather than causing a crash — documented, not silent, behavior."""
    vec = np.zeros(INPUT_DIM, dtype=np.float32)
    for i, name in enumerate(LANDMARK_NAMES):
        if name in keypoints:
            vec[2 * i] = keypoints[name].x
            vec[2 * i + 1] = keypoints[name].y
    return vec


class ExerciseClassifier:
    def __init__(self, weights_path: Optional[str] = None):
        self.model = build_model()
        self._trained = False
        if weights_path:
            self.model.load_weights(weights_path)
            self._trained = True

    def train(self, X: np.ndarray, y: np.ndarray, epochs: int = 50, validation_split: float = 0.1):
        """X: (N, INPUT_DIM) float array. y: (N,) binary labels.
        Matches the paper's stated 90/10 split via validation_split=0.1."""
        history = self.model.fit(X, y, epochs=epochs, validation_split=validation_split, verbose=0)
        self._trained = True
        return history

    def predict(self, keypoints: Dict[str, Keypoint]) -> float:
        if not self._trained:
            raise RuntimeError(
                "ExerciseClassifier has not been trained or loaded with weights. "
                "The source paper's own dataset/weights were never published — train "
                "on your own labeled data first (see train())."
            )
        vec = keypoints_to_vector(keypoints).reshape(1, -1)
        return float(self.model.predict(vec, verbose=0)[0][0])
