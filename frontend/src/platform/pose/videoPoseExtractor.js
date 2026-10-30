// Runs the pose model over a local video file (e.g. a therapist's demonstration) and returns
// one landmark frame per sample. Frames are taken by seeking, not playback, so the result does
// not depend on how fast this device can run the model. The file never leaves the browser.

import { getPoseLandmarker } from "./webPoseLandmarker";

export const MAX_VIDEO_SECONDS = 180;

/**
 * @param {File|Blob} file
 * @param {{fps?: number, onProgress?: (fraction:number) => void, signal?: AbortSignal}} [opts]
 * @returns {Promise<{frames: Array, durationMs: number, width: number, height: number, detectedPct: number}>}
 */
export async function extractPoseFromVideo(file, { fps = 15, onProgress, signal } = {}) {
  const landmarker = await getPoseLandmarker();
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;
  try {
    await waitFor(video, "loadeddata", "This video format cannot be read by the browser. Try an MP4 (H.264) file.");
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("Could not read the video length.");
    if (duration > MAX_VIDEO_SECONDS) throw new Error(`The video is longer than ${MAX_VIDEO_SECONDS / 60} minutes. Trim it to the repetitions you want to use.`);

    const frames = [];
    let detected = 0;
    const step = 1 / fps;
    for (let t = 0; t <= duration; t += step) {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      await seek(video, Math.min(t, duration - 0.001));
      const res = landmarker.detect(video, performance.now());
      if (res.landmarks) detected++;
      frames.push({ t: Math.round(t * 1000), landmarks: res.landmarks, worldLandmarks: res.worldLandmarks, width: video.videoWidth, height: video.videoHeight });
      onProgress?.(Math.min(1, t / duration));
    }
    onProgress?.(1);
    return {
      frames,
      durationMs: Math.round(duration * 1000),
      width: video.videoWidth,
      height: video.videoHeight,
      detectedPct: frames.length ? Math.round((detected / frames.length) * 100) : 0,
    };
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

function waitFor(video, event, errorMessage) {
  return new Promise((resolve, reject) => {
    video.addEventListener(event, resolve, { once: true });
    video.addEventListener("error", () => reject(new Error(errorMessage)), { once: true });
  });
}

function seek(video, time) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The video stopped responding while seeking.")), 10000);
    video.addEventListener(
      "seeked",
      () => {
        // After "seeked" the frame at currentTime is available for drawing / inference.
        // (requestVideoFrameCallback is not used: it never fires for an off-screen video.)
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
    video.currentTime = time;
  });
}
