import { describe, expect, it } from "vitest";
import { rateLimit } from "@/lib/rate-limit";

describe("rateLimit", () => {
  it("allows requests under the limit", () => {
    const key = `test-${Date.now()}`;
    expect(rateLimit(key, 2, 60_000).ok).toBe(true);
    expect(rateLimit(key, 2, 60_000).ok).toBe(true);
  });

  it("blocks when limit exceeded", () => {
    const key = `test-block-${Date.now()}`;
    rateLimit(key, 1, 60_000);
    const second = rateLimit(key, 1, 60_000);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.retryAfterSec).toBeGreaterThan(0);
    }
  });
});
