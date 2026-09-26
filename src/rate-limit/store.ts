export interface RateLimitStore {
  increment(key: string, ttlMs: number): Promise<number>;
  get(key: string): Promise<number>;
  close?(): Promise<void>;
}
