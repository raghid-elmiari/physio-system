// Capacitor Preferences adapter (Android SharedPreferences / iOS UserDefaults) with the same
// synchronous getItem/setItem/removeItem API as webStorage.js. Preferences is async, so all
// keys are loaded into memory once by hydrate() (awaited in main.jsx before the first render)
// and writes go to memory immediately and to Preferences in the background.
// Note: Preferences is not encrypted; the refresh token should move to Keystore/Keychain
// secure storage before a production release.

import { Preferences } from "@capacitor/preferences";

const cache = new Map();

export const nativeStorage = {
  async hydrate() {
    try {
      const { keys } = await Preferences.keys();
      const entries = await Promise.all(keys.map(async (key) => [key, (await Preferences.get({ key })).value]));
      for (const [key, value] of entries) if (value != null) cache.set(key, value);
    } catch {
      // keep running on the (empty) in-memory cache
    }
  },
  getItem(key) {
    return cache.has(key) ? cache.get(key) : null;
  },
  setItem(key, value) {
    cache.set(key, String(value));
    Preferences.set({ key, value: String(value) }).catch(() => {});
  },
  removeItem(key) {
    cache.delete(key);
    Preferences.remove({ key }).catch(() => {});
  },
  isPersistent: true,
};
