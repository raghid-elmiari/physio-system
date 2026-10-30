"""
Tests the parts of device_agent.py that don't require real camera hardware or a real
backend: offline buffering, payload construction, retry/backoff behavior. Run with:
    python3 -m pytest test_device_agent.py -v
or directly:
    python3 test_device_agent.py
"""
import time
import unittest
from unittest.mock import patch, MagicMock

from device_agent import OfflineBuffer, build_event_payload, DeviceAgent


class TestOfflineBuffer(unittest.TestCase):
    def test_push_and_drain_fifo_order(self):
        buf = OfflineBuffer(max_size=10, max_age_seconds=3600)
        buf.push(1, {"a": 1})
        buf.push(1, {"a": 2})
        buf.push(2, {"a": 3})
        drained = list(buf.drain())
        self.assertEqual(len(drained), 3)
        self.assertEqual(drained[0].payload, {"a": 1})
        self.assertEqual(drained[2].session_id, 2)
        self.assertEqual(len(buf), 0)

    def test_bounded_size_drops_oldest(self):
        buf = OfflineBuffer(max_size=2, max_age_seconds=3600)
        buf.push(1, {"seq": 1})
        buf.push(1, {"seq": 2})
        buf.push(1, {"seq": 3})  # should evict seq=1
        drained = [item.payload["seq"] for item in buf.drain()]
        self.assertEqual(drained, [2, 3])

    def test_stale_events_are_evicted(self):
        buf = OfflineBuffer(max_size=10, max_age_seconds=0)  # everything is immediately "stale"
        buf.push(1, {"a": 1})
        time.sleep(0.01)
        drained = list(buf.drain())
        self.assertEqual(len(drained), 0, "stale events should have been evicted, not drained")


class TestEventPayload(unittest.TestCase):
    def test_build_event_payload_matches_backend_dto_shape(self):
        deviation = {"jointName": "left_elbow", "deviationDegrees": 22.4, "feedbackMessage": "Extend your Left Elbow"}
        payload = build_event_payload(sequence_no=5, deviation=deviation)
        # Field names must exactly match EventDtos.IngestEventRequest on the Spring Boot side.
        for field in ("eventUid", "sequenceNo", "eventTimestamp", "jointName", "deviationValue",
                       "feedbackMessage", "source"):
            self.assertIn(field, payload)
        self.assertEqual(payload["sequenceNo"], 5)
        self.assertEqual(payload["jointName"], "left_elbow")
        self.assertEqual(payload["source"], "GEOMETRIC_COMPARISON")

    def test_each_event_gets_a_unique_id(self):
        deviation = {"jointName": "left_elbow", "deviationDegrees": 1.0, "feedbackMessage": "x"}
        p1 = build_event_payload(1, deviation)
        p2 = build_event_payload(1, deviation)
        self.assertNotEqual(p1["eventUid"], p2["eventUid"], "event IDs must be unique for idempotent retries")


class TestDeviceAgentFallbackToBuffer(unittest.TestCase):
    def _make_agent(self):
        config = {
            "device_id": "UNOQ-TEST",
            "api_key": "test-key",
            "backend": {"base_url": "http://backend.invalid", "heartbeat_interval_seconds": 10},
            "ai_service": {"base_url": "http://ai.invalid"},
            "offline_buffer": {"max_queued_events": 100, "max_queue_age_seconds": 3600},
        }
        return DeviceAgent(config)

    @patch("device_agent.AiServiceClient.analyze_frame")
    @patch("device_agent.BackendClient.push_event")
    def test_event_is_buffered_when_backend_push_fails(self, mock_push, mock_analyze):
        mock_analyze.return_value = {
            "detected": True,
            "deviations": [{"jointName": "left_elbow", "deviationDegrees": 30.0, "feedbackMessage": "Extend your Left Elbow"}],
        }
        mock_push.return_value = False  # simulate backend unreachable

        agent = self._make_agent()
        agent.handle_frame(session_id=1, sequence_no=0, jpeg_bytes=b"fake", reference_angles={"left_elbow": 170.0})

        self.assertEqual(len(agent.buffer), 1, "event should have been buffered after a failed push")

    @patch("device_agent.AiServiceClient.analyze_frame")
    @patch("device_agent.BackendClient.push_event")
    def test_event_with_no_feedback_message_is_not_pushed_or_buffered(self, mock_push, mock_analyze):
        # A joint within threshold produces no feedbackMessage — should be skipped entirely,
        # per device_agent.py's "only push events that actually carry a correction" rule.
        mock_analyze.return_value = {
            "detected": True,
            "deviations": [{"jointName": "left_elbow", "deviationDegrees": 2.0, "feedbackMessage": None}],
        }
        agent = self._make_agent()
        agent.handle_frame(session_id=1, sequence_no=0, jpeg_bytes=b"fake", reference_angles={"left_elbow": 170.0})

        mock_push.assert_not_called()
        self.assertEqual(len(agent.buffer), 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
