export class TtlCache {
  constructor(options = {}) {
    this.ttlMs = Math.max(0, Number(options.ttlMs) || 0);
    this.maxEntries = Math.max(1, Number(options.maxEntries) || 500);
    this.now = options.now || (() => Date.now());
    this.map = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) {
      this.misses += 1;
      return undefined;
    }
    if (entry.expiresAt <= this.now()) {
      this.map.delete(key);
      this.misses += 1;
      return undefined;
    }
    this.hits += 1;
    return entry.value;
  }

  set(key, value, ttlMs) {
    const ttl = ttlMs === undefined ? this.ttlMs : Math.max(0, Number(ttlMs) || 0);
    if (!ttl) return value;
    if (this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { value, expiresAt: this.now() + ttl });
    return value;
  }

  delete(key) {
    this.map.delete(key);
  }

  clear() {
    this.map.clear();
  }

  stats() {
    return { size: this.map.size, hits: this.hits, misses: this.misses, ttl_ms: this.ttlMs };
  }
}
