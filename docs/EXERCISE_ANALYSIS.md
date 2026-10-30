# On-device exercise analysis and voice coach

This document describes how a camera frame becomes a spoken correction, how the first
exercise (Shoulder Raise) is evaluated, and how to add more exercises.

> **Clinical status.** MediaPipe estimates body landmarks; it does not know whether a
> rehabilitation exercise is performed correctly. Correctness here comes from
> exercise-specific rules whose thresholds are an **engineering starting point that has not
> been clinically validated**. A physiotherapist must review and calibrate them (per
> protocol / patient group) before patients rely on the feedback.

## Pipeline

```
camera / video file / simulation          src/platform/camera/webCamera.js
        │  (frame, ~30 fps, adaptive)
        ▼
MediaPipe Pose Landmarker (WASM+WebGL)    src/platform/pose/webPoseLandmarker.js
        │  33 normalized landmarks + 33 world landmarks (metres)
        ▼
exercise evaluator                        src/core/exercises/<exercise>.js
  ├─ tracking check (visibility, in-frame)   src/core/analysis/tracking.js
  ├─ feature extraction (angles, speed)      src/core/pose/geometry.js
  ├─ phase state machine + rep counting
  └─ error conditions → ErrorDetector        src/core/analysis/ErrorDetector.js (persistence/hysteresis)
        │  snapshot {phase, reps, activeErrors, events, metrics, trackingQuality}
        ├──────────────► overlay renderer      src/platform/render/drawPose.js
        ├──────────────► SessionRecorder       src/core/session/SessionRecorder.js
        ▼
FeedbackController (what/when to say)     src/core/feedback/FeedbackController.js
        ▼
VoiceCoach (queue, interrupt, mute)       src/core/voice/VoiceCoach.js
        ▼
speech engine adapter                     src/platform/speech/webSpeechEngine.js (Web Speech API)
```

Everything in `src/core/` is plain JavaScript with no browser APIs, so it is shared
unchanged by the web app, a Capacitor build, or a React Native app. Only the four
`src/platform/*` adapters are platform specific. The loop that wires them together for the
browser is `src/features/monitoring/MonitoringPipeline.js`.

No network round trip is involved between a frame and the spoken instruction. The backend
only receives the session summary when the session ends (or later, if offline).

### Performance measures

- One `PoseLandmarker` instance is created per page (GPU delegate, CPU fallback) and reused.
- It is warmed up during "Enable camera" (first inference compiles GPU shaders, measured at
  about 5 s in the embedded Chromium used for testing) so the exercise itself starts smoothly.
- Frames are scheduled with `requestVideoFrameCallback`. The target rate (default 30 fps,
  `VITE_TARGET_FPS`) drops automatically when inference time exceeds ~85% of the frame
  budget (minimum 8 fps), and recovers when there is headroom. Frames are skipped, never
  queued.
- React state is updated at ~10 Hz, not per frame.
- Inference runs on the main thread. On weak devices, moving it into a Web Worker with
  `OffscreenCanvas` is the next step; native apps should use the native MediaPipe SDK
  (see `MOBILE_MIGRATION.md`).

## Shoulder Raise (`shoulder_abduction_bilateral`)

Standing, facing the camera, raise both straight arms sideways to shoulder height, hold,
and lower.

| Item | Definition |
|---|---|
| Required landmarks | shoulders 11/12, elbows 13/14, wrists 15/16, hips 23/24 (ears 7/8 optional, for shrug detection) |
| Untrackable when | any required landmark has visibility < `minVisibility` (0.6) or lies outside the image |
| Abduction angle | angle between the upper arm (shoulder→elbow) and the trunk midline (mid-shoulder→mid-hip), in the image plane (aspect-corrected) |
| Elbow angle | shoulder–elbow–wrist; uses 3D world landmarks when available |
| Trunk lean | angle of mid-hip→mid-shoulder from image vertical (the phone must be upright) |
| Shoulder hiking | ear-to-shoulder vertical distance / shoulder width, compared with the value measured at rest |
| Speed | rate of change of the mean abduction angle over a 200 ms window |

### Phases and repetition logic

```
SETUP ──arms down ≥ 500 ms──► REST ──mean angle > 35°──► RAISING ──both arms ≥ 80°──► HOLDING
                               ▲                            │ falls back 15° below peak      │ held ≥ 1000 ms → hold achieved
                               │                            ▼                                │ drops below 75°
                               └──────mean angle < 30°──── LOWERING ◄────────────────────────┘
```

- A repetition is **counted** only when both arms reached `targetAngle`, stayed there for
  `holdMs`, and returned to rest.
- It is counted as **correct** only when no movement error was active at any point during
  that repetition.
- An attempt that returns to rest without the hold is recorded as `REP_INCOMPLETE`
  (`RANGE_TOO_LOW` or `HOLD_TOO_SHORT`), not counted, and produces a correction.

### Errors (priority order) and messages

| Code | Condition (while arms are moving or up) | Spoken (first / repeat) |
|---|---|---|
| NOT_AT_START | before the first rep, arms not down for 1.5 s | "Return to the starting position, with your arms relaxed at your sides." |
| TRUNK_LEAN | lean > 10° | "Keep your back straight. Don't lean to the side." / "Stand tall, with your shoulders level over your hips." |
| ELBOW_BENT | mean abduction > 45° and elbow < 150° | "Straighten your left/right elbow." or "Keep your elbows straight." / "Make a straight line from your shoulder to your wrist." |
| ARMS_TOO_HIGH | either arm > 115° | "Stop at shoulder height." |
| MOVING_TOO_FAST | angular speed > 200°/s | "Slow down and control the movement." |
| SHOULDERS_HIKED | ear distance < 70% of resting value | "Relax your shoulders down, away from your ears." |
| UNEVEN_ARMS | mean > 40° and arms differ by > 20° | "Lift your left/right arm a little higher to match your right/left." |
| RANGE_TOO_LOW | stalls below target (< 15°/s for 1.2 s) | "Lift your arms a little higher, up to shoulder height." |

Each error must persist for `errorPersistMs` (400 ms; 100 ms for speed, 1.5 s for
NOT_AT_START) before it is reported, and must be absent for 250 ms before it is resolved.
When tracking is lost for more than 600 ms all active errors are cleared and no movement
corrections are given; only a positioning prompt ("Step back so your hips are visible.").
A repetition in progress is discarded after 2 s without tracking.

All thresholds can be overridden per exercise by the backend
(`exercises.analysis_config_json`, returned as `analysisConfig` by `GET /api/exercises/{id}`).

## Voice coach policy (`FeedbackController` + `VoiceCoach`)

- Only active (debounced) errors are eligible, and only while tracking is reliable.
- One correction at a time: the highest-priority active error.
- At least 2 s between corrections; the same error is not repeated within 6 s after it was
  resolved; a persisting error is repeated after 8 s with refined wording, at most 3 times.
- When a spoken error is corrected and stays corrected for 0.7 s with no other error, the
  coach confirms ("Good, keep that position.").
- Repetitions are announced ("Good job! That's two." / "That's two." when it had errors);
  set completion interrupts anything else.
- Only one utterance can wait behind the current one. A queued correction is dropped if its
  error has disappeared or it is older than 2.5 s, so stale instructions are never played.
- Muting stops speech but keeps on-screen captions. Rate, volume, language and voice are
  configurable and stored per device. On-device (`localService`) voices work offline.
- The coach records detection-to-speech latency (error detected → audio starts, including
  queueing) and speech-engine start latency, and both are saved with the session.

## Adding an exercise

1. Create `src/core/exercises/<name>.js` exporting:
   - `ANALYZER_KEY` (string stored in `exercises.analyzer_key`)
   - `DEFAULT_CONFIG` (all thresholds, documented)
   - `ERROR_CATALOG` (`{CODE: {priority, message, persistMs?, landmarks}}`)
   - `REFINED_MESSAGES`, `VOICE_PROMPTS` (`intro`, `ready`, `holdComplete`)
   - `createEvaluator(config, {targetReps})` returning `{update(frame), summaryMetrics(), config, requiredLandmarks, errorCatalog}`;
     `update` must return the snapshot shape documented above (see `shoulderAbduction.js`).
2. Register it in `src/core/exercises/registry.js`.
3. Write tests with synthetic landmark sequences (`src/core/testing/syntheticPose.js`) for
   counted / not counted repetitions, every error, and tracking loss.
4. Add a Flyway migration that inserts the exercise row with `analyzer_key`,
   `instructions`, `camera_setup` and `analysis_config_json` (MySQL and H2 folders).
5. Validate with recorded videos of correct and incorrect performances (use "Use a recorded
   video" on the live page) and have a physiotherapist calibrate the thresholds.

A rule-based evaluator can later be complemented by a trained classifier: add it as another
condition source feeding the same `ErrorDetector`, so the feedback and voice layers do not
change.

## Exercises from a reference video (`reference_dtw`)

Instead of writing a rule-based analyzer, a therapist can create an exercise from a
demonstration video: **Exercises → New exercise from video** (therapist/admin only).

**Building the reference (therapist's browser, nothing uploaded)**

1. `platform/pose/videoPoseExtractor.js` seeks through the video at 15 fps and runs the same
   MediaPipe pose model on each frame (independent of device speed; max 3 minutes).
2. `core/reference/features.js` turns each frame into joint angles: shoulders (arm vs trunk),
   elbows, hips, knees and trunk lean. Angles, not coordinates, so camera distance and body size
   do not matter.
3. `core/reference/buildReference.js` resamples to 30 Hz, smooths, keeps joints visible in ≥80%
   of the video, picks the joint with the largest range as the **main joint** (≥15° range),
   and splits it into repetitions (start/end at 15% of the range, peak ≥70%). The therapist
   can change the main joint, flip which end is "rest", untick repetitions and joints.
4. Saved in `exercises.analysis_config_json` as `{reference: {...}}` via
   `POST /api/therapist/exercises` (or `PUT /api/therapist/exercises/{id}` to replace it):
   the joints, rest/peak angle, the angle curves of each kept repetition (~5-30 KB), an
   envelope (expected angle of every joint at each 10% of the movement) and calibration stats.
   **Only angle curves are stored, never the video.**

**Comparing the patient (`core/exercises/referenceDtw.js`)**

| When | Check | Default |
|---|---|---|
| Live | Not at the starting position before the set | progress ≥ 20% |
| Live | Joint differs from the reference at the same stage of the movement | trunk 10°, other joints 25° (`featureToleranceDeg`) |
| Live | Beyond the reference peak | 20° (`overshootDeg`) |
| Live | Too fast | 1.8 × the reference's fastest movement, min 90°/s |
| Live | Stalled before reaching the range | 1.2 s below 80% of the range |
| End of rep | Not counted if peak < 80% of the reference range | `minPeakProgress` |
| End of rep | **DTW** against every reference repetition (`core/analysis/dtw.js`, Sakoe-Chiba band 25%); the closest gives the score | pass if mean difference ≤ `dtwThresholdDeg` |
| End of rep | Joint most off along the DTW alignment, with direction | > 12° mean |
| End of rep | Tempo vs reference duration | < 0.55× or > 2.2× |

`dtwThresholdDeg` is calibrated from the reference: 2 × the mean DTW distance between the
therapist's own repetitions + 5°, clamped to 8-20° (10° with a single repetition). The match
score shown to the patient maps that threshold to 70%.

DTW makes the comparison independent of speed, but warping also partly hides a smaller range
of motion, which is why range is checked separately (see `dtw.test.js`). A finding that only
shows up after the repetition (tempo, overall shape) is spoken once via a `REP_FEEDBACK` event.

**Limits.** A good match means "close to this one recording", not clinically correct. The
patient must use the same camera angle as the video; it is a 2D front/side comparison;
left/right are the person's sides, so a mirrored demonstration video swaps them. Thresholds
are engineering defaults to be reviewed by a physiotherapist.

**Verified:** 10 unit tests (`dtw.test.js`, `referenceDtw.test.js`) with synthetic poses;
backend integration test for the endpoints; in-app simulated session against a reference built
from synthetic poses (bent elbow, side lean and a short repetition were all caught; 6 reps,
4 correct). The video step was run on a generated clip without a person (pipeline, progress and
"no person detected" warning work). **Not yet verified with a real human demonstration video
or a real patient on camera.**
