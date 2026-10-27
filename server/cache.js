// 아주 작은 TTL + LRU 캐시. 외부 API 호출 횟수를 줄이기 위해 검색 결과를 잠시 보관한다.
export class TtlCache {
  constructor({ ttlMs = 10 * 60 * 1000, maxEntries = 500, now = Date.now } = {}) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.now = now;
    this.map = new Map();
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    // Map은 삽입 순서를 유지하므로 다시 넣으면 "최근 사용"으로 이동한다.
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key, value, ttlMs = this.ttlMs) {
    this.map.delete(key);
    this.map.set(key, { value, expiresAt: this.now() + ttlMs });
    while (this.map.size > this.maxEntries) {
      this.map.delete(this.map.keys().next().value);
    }
  }

  clear() {
    this.map.clear();
  }
}
