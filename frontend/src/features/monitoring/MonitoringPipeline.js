// Real-time loop for the browser build:
//   capture (video frame) -> MediaPipe inference -> evaluator -> feedback -> voice + overlay
//                                                         \-> session recorder
// Design points
//  * The landmarker is created once (platform/pose) and reused for every frame.
//  * Frames are paced with requestVideoFrameCallback (or rAF) and an adaptive target FPS:
//    if inference cannot keep up, the loop processes fewer frames instead of queueing them.
//  * React is updated at ~10 Hz, not per frame, so rendering never competes with inference.
//  * Nothing here talks to the backend; the session works fully offline.

import { config } from "../../config";
import { drawPose } from "../../platform/render/drawPose";
import { interpolateTimeline } from "../../core/testing/syntheticPose";

const UI_INTERVAL_MS = 100;

export class MonitoringPipeline {
  /**
   * @param {object} deps
   * @param {HTMLVideoElement|null} deps.video  null in simulation mode
   * @param {HTMLCanvasElement} deps.canvas
   * @param {{detect: Function, delegate?: string, variant?: string}|null} deps.landmarker
   * @param {object} deps.evaluator   core/exercises/* evaluator
   * @param {object} deps.feedback    FeedbackController
   * @param {object} deps.coach       VoiceCoach
   * @param {object} deps.recorder    SessionRecorder
   * @param {(state: object) => void} deps.onUpdate
   * @param {Array|null} [deps.simulation] keyframes for simulated input instead of the camera
   */
  constructor(deps) {
    Object.assign(this, deps);
    this.running = false;
    this.paused = false;
    this.targetFps = config.targetFps;
    this.fps = this.targetFps;
    this.lastProcessed = -Infinity;
    this.lastUi = -Infinity;
    this.inferEma = null;
    this.processedTimes = [];
    this.skipped = 0;
    this.lastEval = null;
    this.lastLandmarks = null;
    this.handle = null;
    this.simFrames = deps.simulation ? interpolateTimeline(deps.simulation, 30) : null;
    this.simIndex = 0;
    this.simOffset = null;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    this.schedule();
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
    this.lastProcessed = -Infinity;
  }

  stop() {
    this.running = false;
    if (this.handle != null) {
      if (this.video?.cancelVideoFrameCallback && this.usingVfc) this.video.cancelVideoFrameCallback(this.handle);
      else cancelAnimationFrame(this.handle);
    }
    this.handle = null;
  }

  get simulationFinished() {
    return !!this.simFrames && this.simIndex >= this.simFrames.length;
  }

  schedule() {
    if (!this.running) return;
    this.usingVfc = !!this.video?.requestVideoFrameCallback;
    const cb = () => this.tick();
    this.handle = this.usingVfc ? this.video.requestVideoFrameCallback(cb) : requestAnimationFrame(cb);
  }

  tick() {
    if (!this.running) return;
    try {
      const now = performance.now();
      if (!this.paused && now - this.lastProcessed >= 1000 / this.fps - 2) {
        this.lastProcessed = now;
        this.processFrame(now);
      } else if (!this.paused) {
        this.skipped += 1;
      }
    } catch (err) {
      // Never let one bad frame kill the loop; surface it for diagnostics.
      this.onUpdate({ error: err });
    }
    this.schedule();
  }

  processFrame(now) {
    let landmarks = null;
    let worldLandmarks = null;
    let width = 1;
    let height = 1;
    let inferMs = 0;

    if (this.simFrames) {
      if (this.simOffset == null) this.simOffset = now;
      const simT = now - this.simOffset;
      while (this.simIndex < this.simFrames.length - 1 && this.simFrames[this.simIndex + 1].t <= simT) this.simIndex++;
      const f = this.simFrames[Math.min(this.simIndex, this.simFrames.length - 1)];
      if (simT > this.simFrames[this.simFrames.length - 1].t) this.simIndex = this.simFrames.length;
      // Synthetic landmarks are generated in a square coordinate space: keep width = height = 1.
      landmarks = f.landmarks;
    } else {
      const v = this.video;
      if (!v || v.readyState < 2 || !v.videoWidth) return;
      width = v.videoWidth;
      height = v.videoHeight;
      const t0 = performance.now();
      const res = this.landmarker.detect(v, now);
      inferMs = performance.now() - t0;
      landmarks = res.landmarks;
      worldLandmarks = res.worldLandmarks;
      this.adapt(inferMs);
    }

    const ev = this.evaluator.update({ t: now, landmarks, worldLandmarks, width, height });
    this.lastEval = ev;
    this.lastLandmarks = landmarks;

    this.processedTimes.push(now);
    while (this.processedTimes.length && now - this.processedTimes[0] > 1000) this.processedTimes.shift();
    const processedFps = this.processedTimes.length;

    this.recorder.record(ev);
    if (!this.simFrames) this.recorder.recordPerf({ inferenceMs: inferMs, fps: processedFps });

    this.coach.sayAll(this.feedback.process(ev));
    this.coach.revalidate();

    if (this.canvas.width !== width && !this.simFrames) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    const ctx = this.canvas.getContext("2d");
    drawPose(ctx, landmarks, {
      required: this.evaluator.requiredLandmarks,
      highlight: ev.highlight,
      minVisibility: this.evaluator.config.minVisibility,
      status: ev.status,
    });

    if (now - this.lastUi >= UI_INTERVAL_MS || (ev.events && ev.events.length)) {
      this.lastUi = now;
      this.onUpdate({
        evaluation: ev,
        perf: {
          processedFps,
          targetFps: Math.round(this.fps),
          inferenceMs: this.inferEma == null ? null : Math.round(this.inferEma * 10) / 10,
          skippedFrames: this.skipped,
          delegate: this.landmarker?.delegate ?? "simulation",
          model: this.landmarker?.variant ?? "simulation",
        },
        simulationFinished: this.simulationFinished,
      });
    }
  }

  /** Lower the processing rate when inference is slower than the frame budget; raise it again when there is headroom. */
  adapt(inferMs) {
    this.inferEma = this.inferEma == null ? inferMs : 0.9 * this.inferEma + 0.1 * inferMs;
    const budget = 1000 / this.fps;
    if (this.inferEma > budget * 0.85 && this.fps > config.minFps) {
      this.fps = Math.max(config.minFps, this.fps - 1);
    } else if (this.inferEma < budget * 0.5 && this.fps < this.targetFps) {
      this.fps = Math.min(this.targetFps, this.fps + 0.25);
    }
  }
}
