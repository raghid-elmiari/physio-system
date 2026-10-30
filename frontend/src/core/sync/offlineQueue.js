// Durable queue of finished sessions that could not be uploaded (no network / backend down).
// Storage is injected ({getItem, setItem}) so the web build can use localStorage and a
// native build can use Capacitor Preferences / AsyncStorage without touching this logic.
// Each entry is a POST /api/sessions/sync body; the endpoint is idempotent on
// clientSessionId, so re-sending after a partial failure never duplicates a session.

const KEY = "physio.pendingSessions.v1";
const MAX_ENTRIES = 50;

export function createOfflineQueue(storage) {
  function read() {
    try {
      const raw = storage.getItem(KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  function write(list) {
    try {
      storage.setItem(KEY, JSON.stringify(list.slice(-MAX_ENTRIES)));
      return true;
    } catch {
      return false;
    }
  }

  return {
    list: read,
    size: () => read().length,

    /** @param {object} entry SyncSessionRequest body (must contain clientSessionId) */
    enqueue(entry) {
      const list = read().filter((e) => e.clientSessionId !== entry.clientSessionId);
      list.push({ ...entry, queuedAt: new Date().toISOString() });
      return write(list);
    },

    remove(clientSessionId) {
      write(read().filter((e) => e.clientSessionId !== clientSessionId));
    },

    /**
     * Uploads every queued session. Stops at the first network failure (still offline);
     * drops entries the server rejects as invalid (4xx other than 401/408/429) so one bad
     * entry cannot block the queue forever.
     * @param {(entry: object) => Promise<any>} upload
     * @returns {Promise<{synced: number, failed: number, remaining: number}>}
     */
    async flush(upload) {
      let synced = 0;
      let failed = 0;
      for (const entry of read()) {
        const { queuedAt: _queuedAt, ...body } = entry;
        try {
          await upload(body);
          this.remove(entry.clientSessionId);
          synced += 1;
        } catch (err) {
          const status = err?.response?.status;
          if (status && status >= 400 && status < 500 && ![401, 408, 429].includes(status)) {
            this.remove(entry.clientSessionId);
            failed += 1;
            continue;
          }
          break;
        }
      }
      return { synced, failed, remaining: read().length };
    },
  };
}

/** In-memory storage, used in tests and when no persistent storage is available. */
export function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}
