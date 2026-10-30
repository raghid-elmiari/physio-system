import { Capacitor } from "@capacitor/core";
import { nativeStorage } from "./nativeStorage";
import { webStorage } from "./webStorage";

// Key/value storage for the whole app: localStorage on the web, Capacitor Preferences in the
// native app. Callers use the synchronous getItem/setItem/removeItem API.
export const storage = Capacitor.isNativePlatform() ? nativeStorage : webStorage;

/** Await once before rendering: loads persisted values on native, no-op on the web. */
export function initStorage() {
  return storage === nativeStorage ? nativeStorage.hydrate() : Promise.resolve();
}
