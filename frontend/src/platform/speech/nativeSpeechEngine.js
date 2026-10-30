// Native TTS adapter for VoiceCoach in the Capacitor app (Android TextToSpeech / iOS
// AVSpeechSynthesizer via @capacitor-community/text-to-speech). Same interface as
// webSpeechEngine.js. The plugin has no "start" event, so onStart fires on the first word
// boundary (onRangeStart) and, if the platform never reports one, when the utterance ends.

import { QueueStrategy, TextToSpeech } from "@capacitor-community/text-to-speech";

export function createNativeSpeechEngine() {
  let voices = [];
  let active = null; // handlers of the utterance currently playing

  TextToSpeech.addListener("onRangeStart", () => {
    if (active && !active.started) {
      active.started = true;
      active.onStart?.();
    }
  }).catch(() => {});

  const loadVoices = () =>
    TextToSpeech.getSupportedVoices()
      .then(({ voices: list }) => (voices = list || []))
      .catch(() => (voices = []));
  const voicesReady = loadVoices();

  return {
    isAvailable: () => true,

    /** @returns {Promise<Array<{id:string, name:string, lang:string, local:boolean, default:boolean}>>} */
    async listVoices() {
      await voicesReady;
      if (!voices.length) await loadVoices();
      return voices.map((v) => ({ id: v.voiceURI, name: v.name, lang: v.lang, local: v.localService, default: v.default }));
    },

    speak(text, { rate = 1, volume = 1, pitch = 1, lang = "en-US", voiceId = null } = {}, { onStart, onEnd, onError } = {}) {
      const handlers = { onStart, started: false };
      active = handlers;
      const index = voiceId ? voices.findIndex((v) => v.voiceURI === voiceId) : -1;
      const options = { text, rate, volume, pitch, lang, queueStrategy: QueueStrategy.Flush };
      if (index >= 0) {
        options.voice = index;
        options.lang = voices[index].lang;
      }
      TextToSpeech.speak(options).then(
        () => {
          if (active !== handlers) return; // cancelled or replaced
          active = null;
          if (!handlers.started) onStart?.();
          onEnd?.();
        },
        (err) => {
          if (active !== handlers) return;
          active = null;
          onError?.(err);
        }
      );
    },

    cancel() {
      active = null;
      TextToSpeech.stop().catch(() => {});
    },

    /** Native audio needs no user-gesture unlock; kept for interface parity with the web engine. */
    unlock() {},
  };
}
