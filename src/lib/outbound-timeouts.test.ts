import { afterEach, describe, expect, it, vi } from "vitest";
import { sendAuditAlert } from "@/lib/alerts/audit-alerts";
import { askOpenRouter } from "@/lib/brain/openrouter";
import { triggerAuditWorkerDispatch } from "@/lib/worker/trigger-worker";

const saved = { ...process.env };
afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...saved };
});

/** fetch that records its options and fails the way an aborted timeout does. */
function timingOutFetch() {
  const calls: RequestInit[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    calls.push(init);
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  });
  return calls;
}

describe("outbound calls have timeouts and fail softly", () => {
  it("an unreachable email provider doesn't throw into the audit that raised the alert", async () => {
    Object.assign(process.env, { ADMIN_ALERT_EMAIL: "owner@example.com", RESEND_API_KEY: "re_test" });
    const calls = timingOutFetch();
    await expect(sendAuditAlert({ auditId: "a1", reason: "boom", status: "failed" })).resolves.toEqual({ sent: false, reason: "resend_unreachable" });
    expect(calls[0].signal).toBeInstanceOf(AbortSignal);
  });

  it("a hung model falls back to the template answer", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const calls = timingOutFetch();
    await expect(askOpenRouter("why?", "context")).resolves.toBeNull();
    expect(calls[0].signal).toBeInstanceOf(AbortSignal);
  });

  it("the worker dispatch is bounded too", async () => {
    process.env.GITHUB_WORKFLOW_TOKEN = "ghp_test";
    const calls = timingOutFetch();
    await expect(triggerAuditWorkerDispatch()).rejects.toThrow(/timeout/);
    expect(calls[0].signal).toBeInstanceOf(AbortSignal);
  });
});
