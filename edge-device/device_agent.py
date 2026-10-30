"""
Runs on the Arduino UNO Q's Debian Linux side (the QRB2210/Python environment — see
the earlier ESP32-P4 vs. Arduino UNO Q feasibility analysis in this project's history
for why UNO Q, not ESP32-P4, is the board that can actually run this).

Responsibilities (Section 39 of the master spec, "Complete Hardware Workflow"):
  1. Boot: load config, register/verify device credentials.
  2. Capture frames from the local webcam.
  3. Send each frame to the AI microservice for pose comparison.
  4. Push accepted deviation events to Spring Boot's device-ingestion API.
  5. Send periodic heartbeats so the backend's device-status logic (Section 16/17)
     has something real to compute ONLINE/OFFLINE from.
  6. If the backend is unreachable, buffer events locally (bounded queue) and
     flush them on reconnect — Section 18/26 "Offline Edge Operation".

This file is written to run for real against a live camera + live backend + live AI
service. In this sandbox none of those three exist, so it cannot be executed
end-to-end here — but every unit below (config loading, offline buffering, retry
logic, payload construction) is tested independently in test_device_agent.py,
which DOES run in this sandbox and DOES pass.
"""
import base64
import collections
import logging
import queue
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Optional

import requests
import yaml

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("device_agent")


def load_config(path: str = "config.yaml") -> dict:
    with open(path, "r") as f:
        return yaml.safe_load(f)


@dataclass
class QueuedEvent:
    session_id: int
    payload: dict
    queued_at: float = field(default_factory=time.time)


class OfflineBuffer:
    """
    Bounded FIFO queue for events the backend couldn't accept (network down, backend
    down). Implements Section 18's requirement: "Only implement persistent local
    storage if supported by the actual UNO Q configuration" — UNO Q's Linux
    filesystem genuinely supports this, so an in-memory bounded queue (simple,
    sufficient for this MVP's scale) is used rather than over-building a
    database-backed queue the project doesn't yet need.
    """

    def __init__(self, max_size: int, max_age_seconds: int):
        self._queue: "collections.deque[QueuedEvent]" = collections.deque()
        self.max_size = max_size
        self.max_age_seconds = max_age_seconds

    def push(self, session_id: int, payload: dict):
        self._evict_stale()
        if len(self._queue) >= self.max_size:
            dropped = self._queue.popleft()
            log.warning("Offline buffer full — dropping oldest event (session %s)", dropped.session_id)
        self._queue.append(QueuedEvent(session_id=session_id, payload=payload))

    def _evict_stale(self):
        cutoff = time.time() - self.max_age_seconds
        while self._queue and self._queue[0].queued_at < cutoff:
            stale = self._queue.popleft()
            log.warning("Dropping stale buffered event (session %s, age > %ss)",
                        stale.session_id, self.max_age_seconds)

    def drain(self):
        """Yields and removes all currently-queued events, oldest first."""
        self._evict_stale()
        while self._queue:
            yield self._queue.popleft()

    def __len__(self):
        return len(self._queue)


class BackendClient:
    def __init__(self, base_url: str, device_id: str, api_key: str, timeout_seconds: float = 5.0):
        self.base_url = base_url.rstrip("/")
        self.headers = {"X-Device-Id": device_id, "X-Api-Key": api_key}
        self.timeout = timeout_seconds

    def heartbeat(self, device_id: str) -> bool:
        try:
            r = requests.post(f"{self.base_url}/api/device/heartbeat",
                               json={"deviceId": device_id}, headers=self.headers, timeout=self.timeout)
            return r.status_code == 200
        except requests.RequestException as e:
            log.warning("Heartbeat failed: %s", e)
            return False

    def push_event(self, session_id: int, payload: dict) -> bool:
        try:
            r = requests.post(
                f"{self.base_url}/api/device/sessions/{session_id}/events",
                json=payload, headers=self.headers, timeout=self.timeout,
            )
            return r.status_code == 200
        except requests.RequestException as e:
            log.warning("Event push failed (will buffer): %s", e)
            return False


class AiServiceClient:
    def __init__(self, base_url: str, timeout_seconds: float = 5.0):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout_seconds

    def analyze_frame(self, jpeg_bytes: bytes, reference_angles: dict, threshold_degrees: float = 15.0) -> Optional[dict]:
        b64 = base64.b64encode(jpeg_bytes).decode()
        try:
            r = requests.post(
                f"{self.base_url}/analyze-frame",
                json={"frameBase64": b64, "referenceAngles": reference_angles, "thresholdDegrees": threshold_degrees},
                timeout=self.timeout,
            )
            if r.status_code == 200:
                return r.json()
            log.warning("AI service returned %s: %s", r.status_code, r.text)
            return None
        except requests.RequestException as e:
            log.warning("AI service call failed: %s", e)
            return None


def build_event_payload(sequence_no: int, deviation: dict) -> dict:
    """Matches EventDtos.IngestEventRequest on the Spring Boot side exactly."""
    return {
        "eventUid": str(uuid.uuid4()),
        "sequenceNo": sequence_no,
        "eventTimestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "jointName": deviation["jointName"],
        "deviationValue": deviation["deviationDegrees"],
        "feedbackMessage": deviation.get("feedbackMessage"),
        "source": "GEOMETRIC_COMPARISON",
    }


class DeviceAgent:
    def __init__(self, config: dict):
        self.config = config
        self.device_id = config["device_id"]
        self.backend = BackendClient(
            config["backend"]["base_url"], self.device_id, config["api_key"])
        self.ai_service = AiServiceClient(config["ai_service"]["base_url"])
        self.buffer = OfflineBuffer(
            config["offline_buffer"]["max_queued_events"],
            config["offline_buffer"]["max_queue_age_seconds"],
        )
        self._stop = threading.Event()

    def start_heartbeat_loop(self):
        interval = self.config["backend"]["heartbeat_interval_seconds"]

        def loop():
            while not self._stop.is_set():
                ok = self.backend.heartbeat(self.device_id)
                log.info("Heartbeat %s", "OK" if ok else "FAILED (offline?)")
                self._flush_buffer_if_possible()
                self._stop.wait(interval)

        threading.Thread(target=loop, daemon=True).start()

    def _flush_buffer_if_possible(self):
        if len(self.buffer) == 0:
            return
        flushed, failed = 0, 0
        for item in list(self.buffer.drain()):
            if self.backend.push_event(item.session_id, item.payload):
                flushed += 1
            else:
                self.buffer.push(item.session_id, item.payload)  # re-queue, still offline
                failed += 1
                break  # stop trying once we hit another failure — avoid a busy-fail loop
        if flushed:
            log.info("Flushed %d buffered events (%d still queued)", flushed, len(self.buffer))

    def handle_frame(self, session_id: int, sequence_no: int, jpeg_bytes: bytes, reference_angles: dict):
        result = self.ai_service.analyze_frame(jpeg_bytes, reference_angles)
        if not result or not result.get("detected"):
            return
        for deviation in result.get("deviations", []):
            if not deviation.get("feedbackMessage"):
                continue  # only push events that actually carry a correction, not every frame
            payload = build_event_payload(sequence_no, deviation)
            if not self.backend.push_event(session_id, payload):
                self.buffer.push(session_id, payload)

    def stop(self):
        self._stop.set()


def run_camera_loop(agent: DeviceAgent, session_id: int, reference_angles: dict):  # pragma: no cover
    """
    Requires a real camera and is NOT exercised in this sandbox (no webcam hardware
    available here) — this is the actual production entry point, kept separate from
    the unit-testable logic above precisely so the latter could be verified without
    hardware.
    """
    import cv2  # imported lazily so the rest of this module stays importable/testable
    # without opencv's native camera backend being present in every environment.

    cap = cv2.VideoCapture(agent.config["camera"]["index"])
    target_fps = agent.config["camera"]["target_fps"]
    frame_interval = 1.0 / target_fps
    sequence_no = 0

    agent.start_heartbeat_loop()
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                log.warning("Camera read failed — retrying")
                time.sleep(1.0)
                continue
            ok, jpeg = cv2.imencode(".jpg", frame)
            if ok:
                agent.handle_frame(session_id, sequence_no, jpeg.tobytes(), reference_angles)
                sequence_no += 1
            time.sleep(frame_interval)
    except KeyboardInterrupt:
        pass
    finally:
        cap.release()
        agent.stop()


if __name__ == "__main__":  # pragma: no cover
    cfg = load_config()
    agent = DeviceAgent(cfg)
    # reference_angles would normally be fetched from the backend for the selected
    # exercise at session start; hardcoded here only as a runnable example.
    demo_reference_angles = {"left_elbow": 170.0, "right_elbow": 170.0}
    run_camera_loop(agent, session_id=1, reference_angles=demo_reference_angles)
