import { describe, expect, it } from "vitest";
import { rateLimit } from "@/lib/rate-limit";

describe("rateLimit", () => {
  it("allows requests under the limit", async () => {
    const key = `test-${Date.now()}`;
    expect((await rateLimit(key, 2, 60_000)).ok).toBe(true);
    expect((await rateLimit(key, 2, 60_000)).ok).toBe(true);
  });

  it("blocks when limit exceeded", async () => {
    const key = `test-block-${Date.now()}`;
    await rateLimit(key, 1, 60_000);
    const second = await rateLimit(key, 1, 60_000);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.retryAfterSec).toBeGreaterThan(0);
    }
  });
});
