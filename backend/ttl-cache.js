class TtlCache {
  constructor({ ttlMs, maxEntries = 5000 }) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.store = new Map();
  }

  get(key) {
    const hit = this.store.get(key);
    if (!hit) {
      return null;
    }

    if (Date.now() - hit.storedAt > this.ttlMs) {
      this.store.delete(key);
      return null;
    }

    return hit.value;
  }

  set(key, value) {
    if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest) {
        this.store.delete(oldest);
      }
    }

    this.store.set(key, { value, storedAt: Date.now() });
  }

  size() {
    return this.store.size;
  }
}

module.exports = {
  TtlCache,
};
