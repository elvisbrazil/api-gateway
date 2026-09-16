import type { CircuitBreakerOptions } from "../config/schema.js";

export type CircuitState = "closed" | "open" | "half-open";

export class CircuitBreaker {
  private current: CircuitState = "closed";
  private failures = 0;
  private openedAt = 0;
  private trialInFlight = false;

  constructor(
    private readonly options: CircuitBreakerOptions,
    private readonly now: () => number = Date.now,
  ) {}

  get state(): CircuitState {
    if (this.current === "open" && this.now() - this.openedAt >= this.options.cooldownMs) {
      this.current = "half-open";
      this.trialInFlight = false;
    }
    return this.current;
  }

  allowRequest(): boolean {
    switch (this.state) {
      case "closed":
        return true;
      case "open":
        return false;
      case "half-open":
        if (this.trialInFlight) return false;
        this.trialInFlight = true;
        return true;
    }
  }

  recordSuccess() {
    this.failures = 0;
    this.trialInFlight = false;
    this.current = "closed";
  }

  recordFailure() {
    if (this.state === "half-open") {
      this.open();
      return;
    }
    this.failures += 1;
    if (this.failures >= this.options.failureThreshold) this.open();
  }

  private open() {
    this.current = "open";
    this.openedAt = this.now();
    this.failures = 0;
    this.trialInFlight = false;
  }
}
