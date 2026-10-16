import type { IncomingHttpHeaders } from "node:http";
import { LRUCache } from "lru-cache";

export interface CachedResponse {
  statusCode: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

export interface ResponseCacheOptions {
  maxEntries?: number;
  maxBytes?: number;
}

export class ResponseCache {
  private readonly entries: LRUCache<string, CachedResponse>;

  constructor(options: ResponseCacheOptions = {}) {
    this.entries = new LRUCache({
      max: options.maxEntries ?? 1_000,
      maxSize: options.maxBytes ?? 50 * 1024 * 1024,
      sizeCalculation: (entry) => Math.max(1, entry.body.length),
    });
  }

  get(key: string) {
    return this.entries.get(key);
  }

  set(key: string, response: CachedResponse, ttlMs: number) {
    this.entries.set(key, response, { ttl: ttlMs });
  }
}

export function isCacheable(statusCode: number, headers: IncomingHttpHeaders) {
  if (statusCode !== 200 || headers["set-cookie"]) return false;
  const directives = (headers["cache-control"] ?? "")
    .toLowerCase()
    .split(",")
    .map((d) => d.trim());
  return !directives.includes("no-store") && !directives.includes("private");
}
