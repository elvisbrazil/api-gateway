import type { RateLimitStore } from "./store.js";

interface Entry {
  count: number;
  expiresAt: number;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly sweepThreshold = 10_000,
  ) {}

  increment(key: string, ttlMs: number): Promise<number> {
    const now = this.now();
    const entry = this.live(key, now);
    if (entry) {
      entry.count += 1;
      return Promise.resolve(entry.count);
    }
    if (this.entries.size >= this.sweepThreshold) this.sweep(now);
    this.entries.set(key, { count: 1, expiresAt: now + ttlMs });
    return Promise.resolve(1);
  }

  get(key: string): Promise<number> {
    return Promise.resolve(this.live(key, this.now())?.count ?? 0);
  }

  private live(key: string, now: number) {
    const entry = this.entries.get(key);
    if (entry && entry.expiresAt <= now) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }

  private sweep(now: number) {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }
}
