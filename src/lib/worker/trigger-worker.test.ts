import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const afterCallbacks: Array<() => unknown> = [];
let afterThrows = false;
const reportError = vi.fn();

vi.mock("next/server", () => ({
  after: (callback: () => unknown) => {
    if (afterThrows) throw new Error("after was called outside a request scope");
    afterCallbacks.push(callback);
  },
}));
vi.mock("@/lib/monitoring", () => ({ reportError: (...args: unknown[]) => reportError(...args) }));

import { requestAuditWorker } from "@/lib/worker/trigger-worker";

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const savedToken = process.env.GITHUB_WORKFLOW_TOKEN;
const savedGithubToken = process.env.GITHUB_TOKEN;

async function runAfterCallbacks() {
  await Promise.all(afterCallbacks.splice(0).map((callback) => callback()));
}

beforeEach(() => {
  afterCallbacks.length = 0;
  afterThrows = false;
  reportError.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (savedToken === undefined) delete process.env.GITHUB_WORKFLOW_TOKEN;
  else process.env.GITHUB_WORKFLOW_TOKEN = savedToken;
  if (savedGithubToken === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = savedGithubToken;
});

describe("requestAuditWorker", () => {
  it("hands the request to GitHub after the response, not during it", async () => {
    process.env.GITHUB_WORKFLOW_TOKEN = "ghp_test";
    const fetchSpy = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchSpy);

    requestAuditWorker();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(afterCallbacks).toHaveLength(1);

    await runAfterCallbacks();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String((fetchSpy.mock.calls[0] as unknown[])[0])).toContain("/actions/workflows/audit-worker.yml/dispatches");
    expect(reportError).not.toHaveBeenCalled();
  });

  it("reports a missing token instead of staying silent", async () => {
    delete process.env.GITHUB_WORKFLOW_TOKEN;
    delete process.env.GITHUB_TOKEN;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    requestAuditWorker();
    await runAfterCallbacks();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledTimes(1);
    const [error, context] = reportError.mock.calls[0];
    expect((error as Error).message).toContain("no_github_token");
    expect(context).toEqual({ component: "worker" });
  });

  it("reports an expired or rejected token", async () => {
    process.env.GITHUB_WORKFLOW_TOKEN = "ghp_expired";
    vi.stubGlobal("fetch", async () => new Response('{"message":"Bad credentials"}', { status: 401 }));

    requestAuditWorker();
    await runAfterCallbacks();

    expect(reportError).toHaveBeenCalledTimes(1);
    expect(((reportError.mock.calls[0][0]) as Error).message).toContain("github_401");
  });

  it("reports a network failure or timeout without throwing", async () => {
    process.env.GITHUB_WORKFLOW_TOKEN = "ghp_test";
    vi.stubGlobal("fetch", async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });

    requestAuditWorker();
    await expect(runAfterCallbacks()).resolves.toBeUndefined();

    expect(reportError).toHaveBeenCalledTimes(1);
    expect(((reportError.mock.calls[0][0]) as Error).message).toContain("timeout");
  });

  it("still tries outside a request, where there is nothing to keep alive", async () => {
    process.env.GITHUB_WORKFLOW_TOKEN = "ghp_test";
    afterThrows = true;
    const fetchSpy = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchSpy);

    expect(() => requestAuditWorker()).not.toThrow();
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
  });
});

describe("worker dispatch wiring", () => {
  it("every place that queues a run asks for the worker through the reporting helper", () => {
    for (const file of ["src/lib/audit-queue.ts", "src/lib/guard/service.ts", "src/app/api/verify/run/route.ts"]) {
      const source = read(file);
      expect(source, file).toContain("requestAuditWorker();");
      expect(source, file).not.toMatch(/void triggerAuditWorkerDispatch/);
      expect(source, file).not.toContain("cron fallback");
    }
  });
});
