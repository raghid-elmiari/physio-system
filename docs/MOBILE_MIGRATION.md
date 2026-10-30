# Android / iOS migration plan

**Status: a Capacitor Android project exists (`frontend/android`), but it has never been
compiled or run.** `npm run build && npx cap sync android` succeeds and the web build, lint
and 26 unit tests still pass. No Gradle build, APK, emulator or device run has been done:
the machine used had no Android SDK and only JDK 11 (Capacitor 8 needs JDK 21 + Android
Studio). No iOS project exists.

## What was done (Capacitor 8.5, Android)

| Item | Where | Verified |
|---|---|---|
| `@capacitor/core`, `@capacitor/android`, `@capacitor/cli` 8.5.3; `npx cap init PhysioCoach com.example.physiocoach --web-dir dist`; `npx cap add android` | `frontend/capacitor.config.json`, `frontend/android/` | `cap sync android` succeeds; both plugins detected |
| `CAMERA` permission (+ `android.hardware.camera` as optional feature) | `android/app/src/main/AndroidManifest.xml` | Not run: the runtime permission prompt is untested |
| Native TTS adapter (`@capacitor-community/text-to-speech` 8.0.2) with the VoiceCoach engine interface (`isAvailable`, `speak`, `cancel`, plus `listVoices`/`unlock`) | `src/platform/speech/nativeSpeechEngine.js` | Not run on a device. `onStart` = first word boundary (`onRangeStart`), or utterance end if the engine never reports one, so "speech engine start" latency on native means "first word" |
| Native storage on Capacitor Preferences, same sync API as `webStorage` (in-memory cache hydrated before first render, write-through) | `src/platform/storage/nativeStorage.js`, `main.jsx` | Not run on a device |
| Runtime selection with `Capacitor.isNativePlatform()` | `src/platform/speech/index.js`, `src/platform/storage/index.js` | Web path checked in a desktop browser: `isNativePlatform()` is false, login page renders, no new console errors |
| npm scripts `android:sync` (build + sync) and `android:open` | `frontend/package.json` | `android:sync` runs |

`src/core/**` is unchanged. MediaPipe WASM and both pose models are bundled into the APK
assets (~54 MB in `android/app/src/main/assets/public`); consider shipping only the lite model.

### Known gaps before the app can talk to the backend

- **CORS origin:** Capacitor 6+ on Android serves the app from `https://localhost`, which is
  **not** in the backend's default `CORS_ALLOWED_ORIGINS` (it has `capacitor://localhost`
  (iOS) and `http://localhost`). Add `https://localhost` to `CORS_ALLOWED_ORIGINS`.
- **HTTP backend in development:** an `https://localhost` WebView blocks calls to
  `http://<PC-IP>:8080` (mixed content + Android cleartext policy). Use an HTTPS backend, or,
  for local development only, add `"server": { "cleartext": true }` and
  `"android": { "allowMixedContent": true }` to `capacitor.config.json` (never in release).
- **Secure storage:** Preferences (SharedPreferences) is not encrypted; the refresh token
  should move to a Keystore-backed plugin before release.
- **Network-triggered sync:** `@capacitor/network` is not added yet; queued sessions are
  synced on the existing app triggers only.

## What is already mobile-ready

| Area | State |
|---|---|
| UI | Responsive (bottom tab bar under 720 px, stacked tables, safe-area padding, 44 px touch targets). Verified at 375×812 in a desktop browser, not on a device. |
| Business logic | `src/core/**` (evaluators incl. reference matching/DTW, error detection, feedback policy, voice queue, session recorder, offline queue) is plain JS with no DOM/browser APIs and is covered by unit tests. |
| Platform adapters | Camera (`platform/camera`), pose model (`platform/pose`), speech (`platform/speech`), storage (`platform/storage`), overlay (`platform/render`). These are the only files to replace per platform. |
| API | Bearer-token REST API, refresh-token rotation, consistent JSON errors, CORS allows `capacitor://localhost` (iOS) and `http://localhost` by default; the Android app origin `https://localhost` must be added (see above). All calls are in `src/api/services.js`. |
| Offline | Sessions run without the backend; summaries are queued and synced idempotently (`POST /api/sessions/sync`). |
| Privacy | Video never leaves the device; only derived metrics are uploaded. |

## Options evaluated

### A. Capacitor (wrap the existing React app)

- Reuses 100% of the UI and logic. Effort: days.
- Camera: `getUserMedia` works in Android System WebView (Capacitor grants the request when the
  app holds the `CAMERA` permission) and in iOS WKWebView (iOS 14.3+).
- Pose: `@mediapipe/tasks-vision` (WASM + WebGL2) runs inside the WebView. Expect lower and
  more variable throughput than native MediaPipe, especially on low-end Android and older iOS.
- TTS: `speechSynthesis` is not reliably available in Android WebView, so a native TTS
  adapter (`@capacitor-community/text-to-speech`, now in `platform/speech`) implements the engine
  interface in `core/voice/VoiceCoach.js`. Native TTS usually has offline voices (not verified).
- Storage: Capacitor Preferences replaces `webStorage.js` on native (done); the
  refresh token should still move to secure storage (Keychain / Keystore plugin).

### B. React Native (new UI, native camera + MediaPipe)

- Camera: `react-native-vision-camera` frame processors (run on a separate thread).
- Pose: MediaPipe Tasks native SDK (Android `com.google.mediapipe:tasks-vision`, iOS
  `MediaPipeTasksVision`) behind a frame-processor plugin. Best latency/FPS and thermals.
- Reuse: `src/core/**` and `src/api/services.js` unchanged; all screens must be rewritten
  in React Native components (about 12 screens today). Effort: weeks.

## Recommendation

1. **Start with Capacitor** (fastest path to a real device, zero UI rewrite), add the native
   TTS and secure-storage adapters, and **measure on the target devices**:
   processed FPS, inference ms, detection-to-speech latency (all already recorded in each
   session's `metrics` and visible in the report), battery/thermal over a 10-minute session.
2. **Decision gate:** if, on the lowest-end target device, processed FPS stays below ~15,
   or detection-to-speech p95 exceeds ~700 ms, or the device throttles thermally, move the
   camera + inference path to native: either React Native (option B) or a custom Capacitor
   plugin that runs native MediaPipe and streams landmarks to the WebView (keeps the web UI).
   In both cases `src/core` is reused as is, because the evaluator only consumes landmarks.

The real-time requirement is the deciding factor, and it can only be settled with device
measurements, which is why the architecture keeps the inference adapter swappable rather
than committing to a rewrite up front.

## Running the Android app (done up to `cap sync`; the rest is untested)

Prerequisites: Android Studio (bundles JDK 21 and the Android SDK) or JDK 21 +
`ANDROID_HOME`, and a device with USB debugging or an emulator.

```bash
cd frontend
# Point the app at a backend the phone can reach (deployed HTTPS server or LAN IP):
#   VITE_API_BASE_URL=https://<your-server>/api   (in frontend/.env)
npm run android:sync       # = npm run build && npx cap sync android
npm run android:open       # opens frontend/android in Android Studio; press Run
```

Re-run `npm run android:sync` after every web change. Backend: add `https://localhost` to
`CORS_ALLOWED_ORIGINS` (see "Known gaps").

Still to do:

- iOS: `npm install @capacitor/ios && npx cap add ios` (macOS + Xcode only), add
  `NSCameraUsageDescription` to `Info.plist`.
- Move the refresh token from Preferences to Keystore/Keychain secure storage.
- Add `@capacitor/network` to trigger `syncPendingSessions()` when connectivity returns.

## Testing checklist on devices (not yet performed)

- Camera permission: first run, denied, "don't ask again", revoked in settings.
- Lighting: dim room, backlight from a window; partial visibility (step out of frame).
- Phone placement: on a table vs. held; portrait vs. landscape.
- Measure: processed FPS, inference ms, detection-to-speech latency (mean/p95), battery
  drop and temperature over 10 minutes, with lite vs. full model.
- Voice: muted mode, Bluetooth headphones, other audio playing, offline voice availability.
- Offline: airplane mode during and after a session; sync on reconnect.

## Connecting the Android app to your local backend (development)

- `frontend/.env.android.local` (not committed; template `.env.android.example`) sets
  `VITE_API_BASE_URL=http://<PC Wi-Fi IP>:8080/api`. It is used only by
  `npm run build:android` / `npm run android:sync`; `npm run dev` keeps using localhost.
  If your PC's IP changes (`ipconfig` → IPv4 Address), edit the file and run `npm run android:sync` again.
- `capacitor.config.json` sets `server.androidScheme: "http"` and `cleartext: true` so the app
  (origin `http://localhost`) may call a plain-HTTP backend. **Development only**: remove both
  and use an HTTPS backend for any release build. `http://localhost` is still a secure
  context, so camera access keeps working.
- The phone and PC must be on the same Wi-Fi, and Windows Firewall must allow inbound TCP 8080
  for Java on that network (Private profile).
