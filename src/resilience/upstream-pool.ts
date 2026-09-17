import type { CircuitBreakerOptions } from "../config/schema.js";
import { CircuitBreaker } from "./circuit-breaker.js";

export interface UpstreamTarget {
  url: string;
  breaker: CircuitBreaker;
}

export class UpstreamPool {
  readonly targets: UpstreamTarget[];
  private cursor = 0;

  constructor(urls: string[], breakerOptions: CircuitBreakerOptions, now?: () => number) {
    this.targets = urls.map((url) => ({ url, breaker: new CircuitBreaker(breakerOptions, now) }));
  }

  next(): UpstreamTarget | undefined {
    const count = this.targets.length;
    for (let offset = 0; offset < count; offset++) {
      const index = (this.cursor + offset) % count;
      const target = this.targets[index];
      if (target?.breaker.allowRequest()) {
        this.cursor = (index + 1) % count;
        return target;
      }
    }
    return undefined;
  }
}
