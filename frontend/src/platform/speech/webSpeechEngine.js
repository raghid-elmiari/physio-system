// Web Speech API (speechSynthesis) adapter for VoiceCoach. Voices marked localService run
// on-device and keep working offline; network voices (e.g. some Chrome "Google" voices) do not.
// The Capacitor app uses nativeSpeechEngine.js instead (selected in index.js).

export function createWebSpeechEngine() {
  const synth = typeof window !== "undefined" ? window.speechSynthesis : null;
  const supported = !!synth && typeof window.SpeechSynthesisUtterance !== "undefined";
  let voices = [];

  const refreshVoices = () => {
    voices = supported ? synth.getVoices() : [];
    return voices;
  };
  if (supported) {
    refreshVoices();
    synth.addEventListener?.("voiceschanged", refreshVoices);
  }

  return {
    isAvailable: () => supported,

    /** @returns {Promise<Array<{id:string, name:string, lang:string, local:boolean, default:boolean}>>} */
    listVoices() {
      if (!supported) return Promise.resolve([]);
      const map = () => refreshVoices().map((v) => ({ id: v.voiceURI, name: v.name, lang: v.lang, local: v.localService, default: v.default }));
      if (voices.length) return Promise.resolve(map());
      return new Promise((resolve) => {
        const done = () => resolve(map());
        synth.addEventListener?.("voiceschanged", done, { once: true });
        setTimeout(done, 1500);
      });
    },

    speak(text, { rate = 1, volume = 1, pitch = 1, lang = "en-US", voiceId = null } = {}, { onStart, onEnd, onError } = {}) {
      const u = new window.SpeechSynthesisUtterance(text);
      u.rate = rate;
      u.volume = volume;
      u.pitch = pitch;
      u.lang = lang;
      const voice = voiceId ? voices.find((v) => v.voiceURI === voiceId) : voices.find((v) => v.lang === lang && v.localService) || null;
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      }
      u.onstart = () => onStart?.();
      u.onend = () => onEnd?.();
      u.onerror = (e) => (e.error === "interrupted" || e.error === "canceled" ? onEnd?.() : onError?.(e));
      // Chrome can get stuck "paused" after the tab was hidden.
      if (synth.paused) synth.resume();
      synth.speak(u);
    },

    cancel() {
      if (supported) synth.cancel();
    },

    /** Call from a user gesture (e.g. the Start button) so mobile browsers allow later speech. */
    unlock() {
      if (!supported) return;
      const u = new window.SpeechSynthesisUtterance(" ");
      u.volume = 0;
      synth.speak(u);
    },
  };
}
