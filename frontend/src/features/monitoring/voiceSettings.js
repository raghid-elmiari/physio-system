import { DEFAULT_VOICE_SETTINGS } from "../../core/voice/VoiceCoach";
import { storage } from "../../platform/storage";

const KEY = "physio.voiceSettings.v1";

export function loadVoiceSettings() {
  try {
    return { ...DEFAULT_VOICE_SETTINGS, ...JSON.parse(storage.getItem(KEY) || "{}") };
  } catch {
    return { ...DEFAULT_VOICE_SETTINGS };
  }
}

export function saveVoiceSettings(settings) {
  storage.setItem(KEY, JSON.stringify(settings));
}
