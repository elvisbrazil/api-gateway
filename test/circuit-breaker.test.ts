import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CircuitBreaker } from "../src/resilience/circuit-breaker.js";

describe("CircuitBreaker", () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    vi.useFakeTimers();
    breaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1_000 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function fail(times: number) {
    for (let i = 0; i < times; i++) breaker.recordFailure();
  }

  it("starts closed and lets requests through", () => {
    expect(breaker.state).toBe("closed");
    expect(breaker.allowRequest()).toBe(true);
  });

  it("opens after reaching the failure threshold", () => {
    fail(2);
    expect(breaker.state).toBe("closed");

    fail(1);
    expect(breaker.state).toBe("open");
    expect(breaker.allowRequest()).toBe(false);
  });

  it("resets the failure count on success", () => {
    fail(2);
    breaker.recordSuccess();
    fail(2);

    expect(breaker.state).toBe("closed");
  });

  it("moves to half-open once the cooldown has passed", () => {
    fail(3);

    vi.advanceTimersByTime(999);
    expect(breaker.state).toBe("open");

    vi.advanceTimersByTime(1);
    expect(breaker.state).toBe("half-open");
  });

  it("allows a single trial request while half-open", () => {
    fail(3);
    vi.advanceTimersByTime(1_000);

    expect(breaker.allowRequest()).toBe(true);
    expect(breaker.allowRequest()).toBe(false);
  });

  it("closes when the trial request succeeds", () => {
    fail(3);
    vi.advanceTimersByTime(1_000);
    breaker.allowRequest();

    breaker.recordSuccess();

    expect(breaker.state).toBe("closed");
    expect(breaker.allowRequest()).toBe(true);
  });

  it("opens again for a full cooldown when the trial request fails", () => {
    fail(3);
    vi.advanceTimersByTime(1_000);
    breaker.allowRequest();

    breaker.recordFailure();

    expect(breaker.state).toBe("open");
    vi.advanceTimersByTime(999);
    expect(breaker.allowRequest()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(breaker.allowRequest()).toBe(true);
  });
});
