// Turns noisy per-frame error conditions into stable, prioritised movement errors.
//
// A raw condition must hold continuously for `persistMs` before it becomes an active error
// (so one bad landmark estimate never triggers a correction), and must be absent for
// `clearMs` before the error is considered resolved (hysteresis against flicker).

export class ErrorDetector {
  /**
   * @param {Record<string,{message:string, priority:number, landmarks?:number[]}>} catalog
   * @param {{persistMs?:number, clearMs?:number}} opts
   */
  constructor(catalog, { persistMs = 400, clearMs = 250 } = {}) {
    this.catalog = catalog;
    this.persistMs = persistMs;
    this.clearMs = clearMs;
    this.reset();
  }

  reset() {
    this.candidates = new Map(); // code -> {since, detail}
    this.active = new Map(); // code -> {since, lastSeen, detail}
  }

  /**
   * @param {number} t timestamp in ms
   * @param {Array<{code:string, detail?:object}>} conditions raw conditions seen this frame
   * @returns {{active: Array, started: Array, resolved: Array}}
   */
  update(t, conditions) {
    const seen = new Set();
    const started = [];
    const resolved = [];

    for (const c of conditions) {
      if (!this.catalog[c.code]) throw new Error(`Error code not in catalog: ${c.code}`);
      seen.add(c.code);
      const act = this.active.get(c.code);
      if (act) {
        act.lastSeen = t;
        act.detail = c.detail;
        continue;
      }
      const cand = this.candidates.get(c.code);
      if (!cand && (this.catalog[c.code].persistMs ?? this.persistMs) <= 0) {
        this.active.set(c.code, { since: t, lastSeen: t, detail: c.detail });
        started.push(this.describe(c.code, this.active.get(c.code)));
      } else if (!cand) {
        this.candidates.set(c.code, { since: t, detail: c.detail });
      } else {
        cand.detail = c.detail;
        const persistMs = this.catalog[c.code].persistMs ?? this.persistMs;
        if (t - cand.since >= persistMs) {
          this.candidates.delete(c.code);
          this.active.set(c.code, { since: t, lastSeen: t, detail: c.detail });
          started.push(this.describe(c.code, this.active.get(c.code)));
        }
      }
    }

    for (const code of [...this.candidates.keys()]) {
      if (!seen.has(code)) this.candidates.delete(code);
    }
    for (const [code, act] of [...this.active.entries()]) {
      if (!seen.has(code) && t - act.lastSeen >= this.clearMs) {
        this.active.delete(code);
        resolved.push({ code, ...this.catalog[code], durationMs: t - act.since });
      }
    }

    return { active: this.activeList(), started, resolved };
  }

  /** Drop everything without emitting "resolved" (used when tracking is lost). */
  clear() {
    this.reset();
  }

  activeList() {
    return [...this.active.entries()]
      .map(([code, a]) => this.describe(code, a))
      .sort((a, b) => b.priority - a.priority);
  }

  describe(code, a) {
    const entry = this.catalog[code];
    const detail = a.detail || {};
    return {
      code,
      priority: entry.priority,
      // Side-specific / refined text if the exercise supplied one for this occurrence.
      message: detail.message || entry.message,
      landmarks: detail.landmarks || entry.landmarks || [],
      since: a.since,
      detail,
    };
  }
}
