import fs from "node:fs";
import path from "node:path";
import * as Sentry from "@sentry/node";
import { afterEach, describe, expect, it } from "vitest";
import { flushMonitoring, initWorkerMonitoring, reportError } from "@/lib/monitoring";

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const savedDsn = process.env.SENTRY_DSN;

afterEach(async () => {
  await Sentry.close(0);
  if (savedDsn === undefined) delete process.env.SENTRY_DSN;
  else process.env.SENTRY_DSN = savedDsn;
});

describe("worker error monitoring", () => {
  it("does nothing without a DSN", async () => {
    delete process.env.SENTRY_DSN;
    initWorkerMonitoring();
    expect(Sentry.getClient()).toBeUndefined();
    expect(() => reportError(new Error("boom"), { component: "audit", runId: "r1" })).not.toThrow();
    await expect(flushMonitoring()).resolves.toBeUndefined();
  });

  it("reports the error with its component and run id, and nothing about the request or user", async () => {
    process.env.SENTRY_DSN = "https://public@o0.ingest.sentry.io/0";
    initWorkerMonitoring();
    const client = Sentry.getClient();
    expect(client).toBeDefined();
    const sent: Sentry.Event[] = [];
    client!.on("beforeSendEvent", (event) => {
      sent.push(event);
    });

    reportError(new Error("clone failed"), { component: "guard", runId: "run-123" });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(sent).toHaveLength(1);
    expect(sent[0].tags).toMatchObject({ component: "guard", runId: "run-123" });
    expect(sent[0].exception?.values?.[0]?.value).toBe("clone failed");
    expect(sent[0].environment).toMatch(/^worker-/);
    expect(sent[0].user).toBeUndefined();
    expect(sent[0].request).toBeUndefined();
  });
});

describe("monitoring wiring", () => {
  it("flushes reports before the one-shot worker exits", () => {
    const once = read("scripts/worker-once.ts");
    expect(once).toContain("initWorkerMonitoring();");
    // Every exit goes through exit(), which flushes first.
    expect(once.match(/process\.exit\(/g)).toHaveLength(1);
    expect(once).toMatch(/async function exit[\s\S]*await flushMonitoring\(\);\s*process\.exit\(code\)/);
  });

  it("reports caught failures in every worker job", () => {
    expect(read("src/lib/audits.ts")).toContain('reportError(error, { component: "audit"');
    expect(read("src/lib/guard/run.ts")).toContain('reportError(error, { component: "guard"');
    expect(read("src/lib/dynamic-verify/run.ts")).toContain('reportError(error, { component: "verify"');
    expect(read("src/lib/worker/process-audit.ts")).toContain('reportError(error, { component: "repo-checks" })');
  });

  it("gives the worker its DSN, and every client the same privacy settings", () => {
    expect(read(".github/workflows/audit-worker.yml")).toContain("SENTRY_DSN: ${{ secrets.SENTRY_DSN }}");
    for (const file of ["src/instrumentation.ts", "src/instrumentation-client.ts", "src/lib/monitoring.ts"]) {
      expect(read(file)).toContain("dataCollection: SENTRY_DATA_COLLECTION");
    }
  });

  it("uploads source maps only with a token, and deletes them after upload", () => {
    const config = read("next.config.ts");
    expect(config).toMatch(/process\.env\.SENTRY_AUTH_TOKEN\s*\?\s*withSentryConfig/);
    expect(config).toContain("deleteSourcemapsAfterUpload: true");
    expect(config).not.toMatch(/productionBrowserSourceMaps:\s*true/);
  });
});
