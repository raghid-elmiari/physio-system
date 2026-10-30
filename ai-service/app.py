"""
AI microservice — the Python layer Spring Boot delegates all pose/vision work to
(see docs/ARCHITECTURE.md Section 13 for why AI inference stays in Python rather than
being re-implemented in Java).

Endpoints:
  POST /analyze-frame   — given a base64 JPEG frame + a reference angle set, returns
                           deviations and feedback messages for this single frame.
  GET  /health          — liveness check.

This service is stateless per-request by design: the caller (the edge-device agent,
typically) owns session/sequence bookkeeping and pushes accepted events on to Spring
Boot's /api/device/sessions/{id}/events endpoint itself. Keeping this service stateless
keeps it trivially horizontally-scalable later if needed (Section 23, Scalability).
"""
import base64
import time

import cv2
import numpy as np
from flask import Flask, jsonify, request

from comparator import compare_to_reference, DEFAULT_DEVIATION_THRESHOLD_DEGREES
from pose_estimator import PoseEstimator

app = Flask(__name__)
_estimator = PoseEstimator(model_complexity=1)  # "full" tier — pinned explicitly, see pose_estimator.py


@app.get("/health")
def health():
    return jsonify(status="ok")


@app.post("/analyze-frame")
def analyze_frame():
    """
    Request JSON:
    {
      "frameBase64": "<base64 JPEG>",
      "referenceAngles": {"left_elbow": 172.3, "right_knee": 90.1, ...},
      "thresholdDegrees": 15.0   // optional, defaults to comparator.py's constant
    }

    Response JSON:
    {
      "detected": true,
      "processingTimeMs": 42,
      "deviations": [
        {"jointName": "left_elbow", "deviationDegrees": 22.4, "feedbackMessage": "Extend your Left Elbow"},
        ...
      ]
    }
    """
    payload = request.get_json(force=True, silent=False)
    if not payload or "frameBase64" not in payload or "referenceAngles" not in payload:
        return jsonify(error="frameBase64 and referenceAngles are required"), 400

    start = time.time()

    try:
        frame_bytes = base64.b64decode(payload["frameBase64"])
    except Exception:
        return jsonify(error="frameBase64 is not valid base64"), 400

    frame_arr = np.frombuffer(frame_bytes, dtype=np.uint8)
    bgr_frame = cv2.imdecode(frame_arr, cv2.IMREAD_COLOR)
    if bgr_frame is None:
        return jsonify(error="Could not decode image data"), 400

    pose_result = _estimator.process(bgr_frame)
    if not pose_result.detected:
        return jsonify(detected=False, processingTimeMs=int((time.time() - start) * 1000), deviations=[])

    threshold = float(payload.get("thresholdDegrees", DEFAULT_DEVIATION_THRESHOLD_DEGREES))
    deviations = compare_to_reference(pose_result.keypoints, payload["referenceAngles"], threshold)

    response = {
        "detected": True,
        "processingTimeMs": int((time.time() - start) * 1000),
        "deviations": [
            {
                "jointName": d.joint_name,
                "deviationDegrees": round(d.deviation_degrees, 2),
                "feedbackMessage": d.feedback_message,
            }
            for d in deviations
        ],
    }
    return jsonify(response)


if __name__ == "__main__":
    # Development server only. For production, run behind gunicorn/uwsgi — documented
    # in the top-level README, not implemented here (out of scope for this MVP).
    app.run(host="0.0.0.0", port=5001)
