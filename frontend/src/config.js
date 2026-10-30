// Single place for runtime configuration. Values come from Vite env vars (frontend/.env);
// a mobile build (Capacitor) sets VITE_API_BASE_URL to the machine/server the phone can reach.

const env = import.meta.env;

if (env.PROD && !env.VITE_API_BASE_URL) {
  // A production bundle without an API URL would call localhost on the user's own machine.
  console.error("VITE_API_BASE_URL was not set at build time; the app cannot reach the API.");
}

export const config = Object.freeze({
  apiBaseUrl: (env.VITE_API_BASE_URL || "http://localhost:8080/api").replace(/\/$/, ""),
  // MediaPipe assets are served from public/ by default (see scripts/setup-mediapipe.mjs);
  // the CDN URLs are used only as a fallback when the local copy is missing.
  mediapipeWasmPath: env.VITE_MEDIAPIPE_WASM_PATH || `${env.BASE_URL}mediapipe/wasm`,
  mediapipeWasmCdn: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm",
  poseModelVariant: env.VITE_POSE_MODEL || "lite", // "lite" (fast) or "full" (more accurate)
  poseModelPath: (variant) => `${env.BASE_URL}models/pose_landmarker_${variant}.task`,
  poseModelCdn: (variant) =>
    `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${variant}/float16/latest/pose_landmarker_${variant}.task`,
  targetFps: Number(env.VITE_TARGET_FPS || 30),
  minFps: 8,
});
