import { sessionsApi } from "../api/services";
import { createOfflineQueue } from "../core/sync/offlineQueue";
import { storage } from "./storage";

// Sessions finished while offline are kept here and uploaded when the backend is reachable.
export const offlineQueue = createOfflineQueue(storage);

let flushing = null;

/** Upload queued sessions (no-op when the queue is empty). Safe to call often. */
export function syncPendingSessions() {
  if (offlineQueue.size() === 0) return Promise.resolve({ synced: 0, failed: 0, remaining: 0 });
  if (!flushing) {
    flushing = offlineQueue.flush((body) => sessionsApi.sync(body)).finally(() => {
      flushing = null;
    });
  }
  return flushing;
}
