import { Capacitor } from "@capacitor/core";
import { createNativeSpeechEngine } from "./nativeSpeechEngine";
import { createWebSpeechEngine } from "./webSpeechEngine";

// Android WebView has no reliable speechSynthesis, so the native app uses platform TTS.
export function createSpeechEngine() {
  return Capacitor.isNativePlatform() ? createNativeSpeechEngine() : createWebSpeechEngine();
}
