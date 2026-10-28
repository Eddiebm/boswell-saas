import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];

vi.mock("@/lib/audit-queue", () => ({
  recoverStaleAudits: vi.fn(async () => {
    calls.push("recover");
  }),
  claimNextQueuedAudit: vi.fn(async () => {
    calls.push("claim");
    return null as { id: string } | null;
  }),
}));

vi.mock("@/lib/audit-runner", () => ({
  runQueuedAudit: vi.fn(async (id: string) => {
    calls.push(`run:${id}`);
    return { ok: true as const };
  }),
}));

import { processWorkerTick } from "@/lib/audits";
import { claimNextQueuedAudit } from "@/lib/audit-queue";
import { runQueuedAudit } from "@/lib/audit-runner";

describe("processWorkerTick", () => {
  beforeEach(() => {
    calls.length = 0;
    vi.stubEnv("BOSWELL_CLOUD_WORKER", "");
    vi.stubEnv("BOSWELL_ALLOW_LOCAL_WORKER", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does nothing unless the cloud or local worker flag is set", async () => {
    const result = await processWorkerTick();
    expect(result.processed).toBe(false);
    expect("message" in result && result.message).toMatch(/Worker disabled locally/);
    expect(calls).toEqual([]);
  });

  it("recovers stale audits before claiming, and stops when the queue is empty", async () => {
    vi.stubEnv("BOSWELL_CLOUD_WORKER", "1");
    expect(await processWorkerTick()).toEqual({ processed: false });
    expect(calls).toEqual(["recover", "claim"]);
  });

  it("runs the claimed audit and reports its result", async () => {
    vi.stubEnv("BOSWELL_ALLOW_LOCAL_WORKER", "1");
    vi.mocked(claimNextQueuedAudit).mockImplementationOnce(async () => {
      calls.push("claim");
      return { id: "audit-1" } as Awaited<ReturnType<typeof claimNextQueuedAudit>>;
    });
    vi.mocked(runQueuedAudit).mockImplementationOnce(async (id) => {
      calls.push(`run:${id}`);
      return { ok: false as const, error: "clone failed" };
    });
    expect(await processWorkerTick()).toEqual({ processed: true, auditId: "audit-1", ok: false, error: "clone failed" });
    expect(calls).toEqual(["recover", "claim", "run:audit-1"]);
  });
});
