// localStorage wrapper that never throws (private mode, blocked storage, quota) and falls
// back to memory. The Capacitor app uses nativeStorage.js (Preferences) instead; see index.js.

import { memoryStorage } from "../../core/sync/offlineQueue.js";

function probe() {
  try {
    const k = "__physio_probe__";
    window.localStorage.setItem(k, "1");
    window.localStorage.removeItem(k);
    return window.localStorage;
  } catch {
    return null;
  }
}

const backing = typeof window !== "undefined" ? probe() : null;
const fallback = memoryStorage();

export const webStorage = {
  getItem(key) {
    try {
      return backing ? backing.getItem(key) : fallback.getItem(key);
    } catch {
      return fallback.getItem(key);
    }
  },
  setItem(key, value) {
    try {
      if (backing) backing.setItem(key, value);
      else fallback.setItem(key, value);
    } catch {
      fallback.setItem(key, value);
    }
  },
  removeItem(key) {
    try {
      if (backing) backing.removeItem(key);
    } catch {
      // ignore
    }
    fallback.removeItem(key);
  },
  isPersistent: !!backing,
};
