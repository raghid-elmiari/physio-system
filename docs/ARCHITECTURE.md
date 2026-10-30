# Architecture Reference

This is a condensed, code-oriented version of the full 42-section design specification
already produced earlier in this project's design process (the "Reverse-Engineering &
Advanced React + Spring Boot + MySQL Redesign" document). Refer back to that document
for the complete reasoning; this file exists so the reasoning behind specific lines of
code in this repository can be found without leaving the codebase.

## Why a separate Python AI microservice instead of porting MediaPipe to Java

MediaPipe Pose and the paper's own TensorFlow training pipeline are Python-native, with
no actively-maintained JVM port. Re-implementing pose estimation in Java would mean
abandoning a validated approach for a risky rewrite. `ai-service/` stays a small,
focused Python process; Spring Boot (`backend/`) remains the real application backend
(auth, sessions, database, API, business logic) and calls the AI service internally.

## Why MySQL, not MongoDB/Firebase

The data (users, sessions, exercises, reports) is naturally relational with clear
foreign-key relationships (`database/schema.sql`). No requirement in this project calls
for MongoDB's document flexibility or Firebase's vendored real-time sync.

## Why WebSocket (STOMP/SockJS), not polling/SSE/MQTT

The live feedback loop needs to feel instantaneous and doesn't involve a fleet of
independent publishers (ruling out MQTT's pub/sub model as unjustified complexity, per
the "no unnecessary technology" principle). See `WebSocketConfig.java` and
`LiveSession.jsx`.

## Why device auth is separate from user auth

`DeviceApiKeyFilter.java` exists because a UNO Q device and a logged-in patient are
different trust boundaries with different credential lifecycles (Section 15 of the full
spec: "never allow an unknown device to freely submit data"). Devices never get a JWT;
they get a registered `deviceId` + bcrypt-hashed API key, checked on every request to
`/api/device/**`.

## Offline handling

- **Edge device → backend**: `edge-device/device_agent.py`'s `OfflineBuffer` — a
  bounded, age-limited FIFO queue, flushed on the next successful heartbeat. Genuinely
  tested in `test_device_agent.py`.
- **Backend → database**: not implemented as buffering in this MVP — a failed DB write
  currently surfaces as a 500 to the caller, which (for the edge device) triggers its
  own offline-buffer path. A more sophisticated backend-side retry queue is a documented
  future extension, not silently assumed to exist.
- **Frontend → backend**: finished sessions that cannot be uploaded are kept in an on-device
  queue (`frontend/src/core/sync/offlineQueue.js`) and re-sent to the idempotent
  `POST /api/sessions/sync` endpoint when the backend is reachable again.

## Resolved since the MVP

The browser no longer posts events to the device-only endpoint. Live analysis now runs on
the device (browser / future phone app, MediaPipe Tasks in WASM) and the session summary is
sent to patient-scoped, JWT-authenticated endpoints (`/api/sessions/{id}/complete`,
`/api/sessions/sync`). The Python AI service is only used by the optional edge-device flow.
See docs/EXERCISE_ANALYSIS.md and docs/IMPLEMENTATION_NOTES.md.

## Database schema

The schema is defined by the Flyway migrations in
`backend/src/main/resources/db/migration/mysql` (H2 equivalent in `.../h2`).