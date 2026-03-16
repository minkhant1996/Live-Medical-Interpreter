import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WSRateLimiter } from "../middleware/rateLimiter";

describe("WSRateLimiter", () => {
  let limiter: WSRateLimiter;

  beforeEach(() => {
    limiter = new WSRateLimiter(5);
  });

  afterEach(() => {
    limiter.destroy();
  });

  it("allows requests under the limit", () => {
    for (let i = 0; i < 5; i++) {
      expect(limiter.allow("client1")).toBe(true);
    }
  });

  it("blocks requests over the limit", () => {
    for (let i = 0; i < 5; i++) {
      limiter.allow("client1");
    }
    expect(limiter.allow("client1")).toBe(false);
  });

  it("tracks clients independently", () => {
    for (let i = 0; i < 5; i++) {
      limiter.allow("client1");
    }
    // client2 should still be allowed
    expect(limiter.allow("client2")).toBe(true);
  });

  it("removes a client", () => {
    for (let i = 0; i < 5; i++) {
      limiter.allow("client1");
    }
    expect(limiter.allow("client1")).toBe(false);
    limiter.remove("client1");
    // After removal, the client starts fresh
    expect(limiter.allow("client1")).toBe(true);
  });

  it("resets after the time window", async () => {
    const fastLimiter = new WSRateLimiter(2);
    fastLimiter.allow("c1");
    fastLimiter.allow("c1");
    expect(fastLimiter.allow("c1")).toBe(false);

    // Wait for the 1-second window to pass
    await new Promise((r) => setTimeout(r, 1100));
    expect(fastLimiter.allow("c1")).toBe(true);
    fastLimiter.destroy();
  });

  it("defaults to 50 max per second", () => {
    const defaultLimiter = new WSRateLimiter();
    for (let i = 0; i < 50; i++) {
      expect(defaultLimiter.allow("c1")).toBe(true);
    }
    expect(defaultLimiter.allow("c1")).toBe(false);
    defaultLimiter.destroy();
  });

  it("destroy clears all state", () => {
    limiter.allow("c1");
    limiter.destroy();
    // After destroy, a new allow call would start fresh (no crash)
    // We just verify destroy doesn't throw
  });
});
