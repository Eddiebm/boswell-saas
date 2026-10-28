import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import * as Sentry from "@sentry/node";
import { afterEach, describe, expect, it } from "vitest";
import { flushMonitoring, initWorkerMonitoring, reportError } from "@/lib/monitoring";
import { redactSecrets, scrubEvent } from "@/lib/monitoring-config";

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

describe("credential redaction", () => {
  const token = ["ghs", "SENTINELtoken1234567890abcdef"].join("_");

  it("removes tokens from URLs, headers and known key formats", () => {
    expect(redactSecrets(`Command failed: git clone https://x-access-token:${token}@github.com/acme/app.git /tmp/x`)).toBe(
      "Command failed: git clone https://[redacted]@github.com/acme/app.git /tmp/x",
    );
    expect(redactSecrets(`token ${token}`)).not.toContain(token);
    expect(redactSecrets("Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456")).toBe("Authorization: Bearer [redacted]");
    expect(redactSecrets("postgres://app:hunter2secret@db.neon.tech/app")).toBe("postgres://[redacted]@db.neon.tech/app");
    expect(redactSecrets("Repository not found")).toBe("Repository not found");
  });

  it("scrubs every string in an event, nested ones included", () => {
    const event = { message: `x ${token}`, exception: { values: [{ value: `https://u:${token}@github.com` }] }, breadcrumbs: [{ data: { arguments: [`log ${token}`] } }], level: "error" };
    const scrubbed = scrubEvent(event);
    expect(JSON.stringify(scrubbed)).not.toContain(token);
    expect(scrubbed.level).toBe("error");
  });

  it("never sends the token from a real failed clone to Sentry", async () => {
    process.env.SENTRY_DSN = "https://public@o0.ingest.sentry.io/0";
    initWorkerMonitoring();
    const sent: Sentry.Event[] = [];
    Sentry.getClient()!.on("beforeSendEvent", (event) => {
      sent.push(event);
    });
    let cloneError: unknown;
    try {
      execFileSync("git", ["clone", `https://x-access-token:${token}@127.0.0.1:1/acme/app.git`, "/nonexistent/clone"], { stdio: "pipe" });
    } catch (error) {
      cloneError = error;
    }
    expect(String((cloneError as Error).message)).toContain(token); // the leak this guards against
    reportError(cloneError, { component: "audit", runId: "r1" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sent).toHaveLength(1);
    expect(JSON.stringify(sent[0])).not.toContain(token);
    expect(sent[0].exception?.values?.[0]?.value).toContain("https://[redacted]@127.0.0.1:1/acme/app.git");
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
    expect(read("src/lib/audit-runner.ts")).toContain('reportError(error, { component: "audit"');
    expect(read("src/lib/guard/run.ts")).toContain('reportError(error, { component: "guard"');
    expect(read("src/lib/dynamic-verify/run.ts")).toContain('reportError(error, { component: "verify"');
    expect(read("src/lib/worker/process-audit.ts")).toContain('reportError(error, { component: "repo-checks" })');
  });

  it("gives the worker its DSN, and every client the same privacy settings and redaction", () => {
    expect(read(".github/workflows/audit-worker.yml")).toContain("SENTRY_DSN: ${{ secrets.SENTRY_DSN }}");
    for (const file of ["src/instrumentation.ts", "src/instrumentation-client.ts", "src/lib/monitoring.ts"]) {
      expect(read(file)).toContain("dataCollection: SENTRY_DATA_COLLECTION");
      expect(read(file)).toContain("beforeSend: scrubEvent");
    }
  });

  it("redacts failure messages before they're stored, emailed or shown", () => {
    expect(read("src/lib/audit-runner.ts")).toContain('const message = redactSecrets(error instanceof Error ? error.message : "Audit failed");');
    expect(read("src/lib/guard/run.ts")).toContain("const message = redactSecrets(");
    expect(read("src/lib/dynamic-verify/run.ts")).toContain("const message = redactSecrets(");
  });

  it("uploads source maps only with a token, and deletes them after upload", () => {
    const config = read("next.config.ts");
    expect(config).toMatch(/process\.env\.SENTRY_AUTH_TOKEN\s*\?\s*withSentryConfig/);
    expect(config).toContain("deleteSourcemapsAfterUpload: true");
    expect(config).not.toMatch(/productionBrowserSourceMaps:\s*true/);
  });
});
