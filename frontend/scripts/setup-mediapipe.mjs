// Copies the MediaPipe WASM runtime into public/ and downloads the Pose Landmarker model,
// so the app works from localhost (and later inside a Capacitor WebView) without a CDN.
// Runs automatically before `npm run dev` / `npm run build`; safe to re-run.
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wasmSrc = join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const wasmDest = join(root, "public", "mediapipe", "wasm");
const modelDir = join(root, "public", "models");

const MODELS = {
  "pose_landmarker_lite.task":
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task",
  "pose_landmarker_full.task":
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task",
};

function copyWasm() {
  if (!existsSync(wasmSrc)) {
    console.warn("[setup-mediapipe] @mediapipe/tasks-vision is not installed yet; run npm install first.");
    return;
  }
  mkdirSync(wasmDest, { recursive: true });
  for (const file of readdirSync(wasmSrc)) {
    const src = join(wasmSrc, file);
    const dest = join(wasmDest, file);
    if (!existsSync(dest) || statSync(dest).size !== statSync(src).size) copyFileSync(src, dest);
  }
  console.log("[setup-mediapipe] WASM runtime ready in public/mediapipe/wasm");
}

async function downloadModels() {
  mkdirSync(modelDir, { recursive: true });
  for (const [name, url] of Object.entries(MODELS)) {
    const dest = join(modelDir, name);
    if (existsSync(dest) && statSync(dest).size > 1_000_000) continue;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
      console.log(`[setup-mediapipe] downloaded ${name}`);
    } catch (err) {
      // Not fatal: at runtime the app falls back to loading the model from the same URL.
      console.warn(`[setup-mediapipe] could not download ${name} (${err.message}); the app will fetch it from Google's CDN at runtime.`);
    }
  }
}

copyWasm();
await downloadModels();
