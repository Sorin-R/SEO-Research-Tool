/**
 * Simple in-memory cache with TTL support.
 * Useful for caching expensive API calls.
 */

class Cache {
  constructor(ttlMs = 10 * 60 * 1000) {
    this.store = new Map();
    this.ttl = ttlMs;
  }

  set(key, value) {
    const expiresAt = Date.now() + this.ttl;
    this.store.set(key, { value, expiresAt });
  }

  get(key) {
    if (!this.store.has(key)) return null;

    const { value, expiresAt } = this.store.get(key);

    // Check if expired
    if (Date.now() > expiresAt) {
      this.store.delete(key);
      return null;
    }

    return value;
  }

  has(key) {
    return this.get(key) !== null;
  }

  clear() {
    this.store.clear();
  }

  // Return cache stats (useful for debugging)
  stats() {
    return {
      size: this.store.size,
      ttlMinutes: this.ttl / 1000 / 60,
    };
  }
}

module.exports = Cache;
