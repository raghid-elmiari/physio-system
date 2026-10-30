// MediaPipe Pose Landmarker for the web (WASM + WebGL), created once and reused for every
// frame and every session. This module is the only place that imports @mediapipe/tasks-vision;
// a native app replaces it with the MediaPipe Android/iOS Tasks SDK behind the same shape:
//   detect(source, timestampMs) -> { landmarks, worldLandmarks } | null

import { config } from "../../config";

let instancePromise = null;
let instanceKey = null;

async function fileExists(url) {
  try {
    const res = await fetch(url, { method: "HEAD" });
    return res.ok && !(res.headers.get("content-type") || "").includes("text/html");
  } catch {
    return false;
  }
}

async function create(variant, preferGpu) {
  const { FilesetResolver, PoseLandmarker } = await import("@mediapipe/tasks-vision");

  const localWasm = await fileExists(`${config.mediapipeWasmPath}/vision_wasm_internal.wasm`);
  const vision = await FilesetResolver.forVisionTasks(localWasm ? config.mediapipeWasmPath : config.mediapipeWasmCdn);

  const localModel = config.poseModelPath(variant);
  const modelAssetPath = (await fileExists(localModel)) ? localModel : config.poseModelCdn(variant);

  const options = (delegate) => ({
    baseOptions: { modelAssetPath, delegate },
    runningMode: "VIDEO",
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputSegmentationMasks: false,
  });

  let landmarker;
  let delegate = preferGpu ? "GPU" : "CPU";
  try {
    landmarker = await PoseLandmarker.createFromOptions(vision, options(delegate));
  } catch (err) {
    if (delegate !== "GPU") throw err;
    delegate = "CPU"; // no WebGL2 / GPU blocked: fall back to the CPU delegate
    landmarker = await PoseLandmarker.createFromOptions(vision, options(delegate));
  }

  // The first inference compiles GPU shaders and can take seconds; do it now (while the UI
  // shows "loading") instead of freezing the first frames of the exercise.
  let lastTs = 0;
  try {
    const warm = document.createElement("canvas");
    warm.width = 256;
    warm.height = 256;
    warm.getContext("2d").fillRect(0, 0, 256, 256);
    landmarker.detectForVideo(warm, lastTs);
  } catch {
    // warm-up is an optimisation only
  }

  return {
    variant,
    delegate,
    modelSource: modelAssetPath.startsWith("http") ? "cdn" : "local",
    wasmSource: localWasm ? "local" : "cdn",
    /**
     * @param {HTMLVideoElement|HTMLCanvasElement|ImageBitmap} source
     * @param {number} timestampMs must increase monotonically
     */
    detect(source, timestampMs) {
      const ts = Math.max(timestampMs, lastTs + 1);
      lastTs = ts;
      const result = landmarker.detectForVideo(source, ts);
      if (!result.landmarks?.length) return { landmarks: null, worldLandmarks: null };
      return { landmarks: result.landmarks[0], worldLandmarks: result.worldLandmarks?.[0] ?? null };
    },
    close() {
      landmarker.close();
    },
  };
}

/**
 * Returns the shared landmarker, creating it on first use. Switching variant/delegate
 * closes the previous instance.
 */
export function getPoseLandmarker({ variant = config.poseModelVariant, preferGpu = true } = {}) {
  const key = `${variant}:${preferGpu}`;
  if (instancePromise && instanceKey === key) return instancePromise;
  const previous = instancePromise;
  instanceKey = key;
  instancePromise = create(variant, preferGpu).catch((err) => {
    instancePromise = null;
    instanceKey = null;
    throw err;
  });
  previous?.then((p) => p.close()).catch(() => {});
  return instancePromise;
}
