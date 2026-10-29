import { createHmac } from "node:crypto";
import type { Octokit } from "@octokit/rest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { compareGuard, GUARD_MARKER, guardComment, type GuardFinding } from "@/lib/guard/compare";
import { postStatus, queueGuardRun, upsertPrComment } from "@/lib/guard/service";
import { guardTarget, verifySignature } from "@/lib/guard/webhook";

/** Fake drizzle: `select` finds a queued run; `update` reports whether it was still queued. */
const db = vi.hoisted(() => ({ waiting: true, stillQueued: true, inserted: 0, updated: 0 }));
vi.mock("@/lib/db", () => {
  const chain = (result: () => unknown) => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "where", "limit", "set", "values"]) c[m] = () => c;
    c.returning = async () => result();
    c.then = (resolve: (v: unknown) => void) => resolve(result());
    return c;
  };
  return {
    requireDb: () => ({
      select: () => chain(() => (db.waiting ? [{ id: "queued-run" }] : [])),
      update: () => chain(() => (db.updated++, db.stillQueued ? [{ id: "queued-run" }] : [])),
      insert: () => chain(() => (db.inserted++, [{ id: "new-run" }])),
    }),
  };
});
vi.mock("@/lib/worker/trigger-worker", () => ({ requestAuditWorker: () => {} }));

describe("webhook signature", () => {
  const body = '{"zen":"Keep it logically awesome."}';
  const sign = (secret: string) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  it("accepts GitHub's HMAC and rejects anything else", () => {
    expect(verifySignature("s3cret", body, sign("s3cret"))).toBe(true);
    expect(verifySignature("s3cret", body, sign("other"))).toBe(false);
    expect(verifySignature("s3cret", body + " ", sign("s3cret"))).toBe(false);
    expect(verifySignature("s3cret", body, null)).toBe(false);
    expect(verifySignature("s3cret", body, "sha1=abc")).toBe(false);
  });
});

describe("guardTarget", () => {
  it("checks pushes to the default branch only", () => {
    expect(guardTarget("push", { ref: "refs/heads/main", after: "abc123" }, "main")).toEqual({ sha: "abc123", prNumber: null });
    expect(guardTarget("push", { ref: "refs/heads/feature", after: "abc123" }, "main")).toBeNull();
    expect(guardTarget("push", { ref: "refs/heads/main", after: "0000000000000000000000000000000000000000", deleted: true }, "main")).toBeNull();
  });
  it("checks pull requests when opened or updated", () => {
    expect(guardTarget("pull_request", { action: "synchronize", number: 7, pull_request: { head: { sha: "def456" } } }, "main")).toEqual({ sha: "def456", prNumber: 7 });
    expect(guardTarget("pull_request", { action: "closed", number: 7, pull_request: { head: { sha: "def456" } } }, "main")).toBeNull();
    expect(guardTarget("issues", {}, "main")).toBeNull();
  });
});

let n = 0;
const f = (over: Partial<GuardFinding>): GuardFinding => ({
  id: `f${++n}`,
  ruleId: "secrets.hardcoded",
  severity: "CRITICAL",
  category: "secrets",
  title: "Stripe live secret key committed in code",
  description: "",
  filePath: "lib/pay.ts",
  lineStart: 3,
  recommendation: "Rotate it.",
  confidence: 0.9,
  ...over,
});

describe("compareGuard", () => {
  it("fails only on blockers the change introduces", () => {
    const existing = f({ filePath: "lib/old.ts" });
    const added = f({ filePath: "lib/new.ts" });
    const outcome = compareGuard([existing], [existing, added]);
    expect(outcome.state).toBe("failure");
    expect(outcome.newBlockers.map((x) => x.filePath)).toEqual(["lib/new.ts"]);
    expect(outcome.existingBlockers).toBe(1);
    expect(outcome.description).toBe("1 new launch blocker");
  });

  it("passes when blockers were already there, and credits fixes", () => {
    const existing = f({});
    const fixed = f({ ruleId: "money.webhook-unverified", category: "payments", title: "Stripe webhook doesn't verify the signature", filePath: "app/api/stripe/route.ts" });
    const outcome = compareGuard([existing, fixed], [existing]);
    expect(outcome.state).toBe("success");
    expect(outcome.resolved.map((x) => x.ruleId)).toEqual(["money.webhook-unverified"]);
    expect(outcome.description).toBe("No new launch blockers · 1 fixed");
  });

  it("treats count changes in titles as the same finding, and pattern matches as review", () => {
    const before = f({ ruleId: "money.ai-route-no-auth", category: "payments", severity: "HIGH", confidence: 0.65, title: "2 paid AI routes have no login check", filePath: "app/api/a/route.ts" });
    const after = { ...before, id: "x", title: "3 paid AI routes have no login check" };
    expect(compareGuard([before], [after]).newReview).toEqual([]);
    const fresh = compareGuard([], [after]);
    expect(fresh.state).toBe("success");
    expect(fresh.newReview).toHaveLength(1);
  });

  it("fails when an existing finding becomes a blocker", () => {
    // A vulnerable package moved from dev to production dependencies: same identity, MEDIUM → HIGH.
    const dev = f({ ruleId: "deps.vulnerable", category: "dependencies", severity: "MEDIUM", title: "Vulnerable dependency: lodash@4.17.15", filePath: "package-lock.json" });
    const prod = { ...dev, id: "p", severity: "HIGH" as const };
    const outcome = compareGuard([dev], [prod]);
    expect(outcome.state).toBe("failure");
    expect(outcome.newBlockers).toHaveLength(1);
    expect(outcome.existingBlockers).toBe(0);
    expect(compareGuard([prod], [prod]).state).toBe("success");
  });

  it("sets a baseline instead of failing the first run", () => {
    const outcome = compareGuard(null, [f({})]);
    expect(outcome.state).toBe("success");
    expect(outcome.description).toContain("baseline set");
  });
});

describe("guard comment and GitHub calls", () => {
  it("writes one marked comment with the new blockers and their fixes", () => {
    const body = guardComment(compareGuard([], [f({})]), "https://boswell.example/dashboard/ship-ready");
    expect(body.startsWith(GUARD_MARKER)).toBe(true);
    expect(body).toContain("This change adds 1 launch blocker");
    expect(body).toContain("| CRITICAL | Stripe live secret key committed in code | `lib/pay.ts:3` |");
    expect(body).toContain("Rotate it.");
  });

  it("edits its existing PR comment instead of adding another", async () => {
    const rest = { issues: { listComments: vi.fn(), updateComment: vi.fn(), createComment: vi.fn() } };
    const gh = { rest, paginate: vi.fn().mockResolvedValue([{ id: 1, body: "LGTM" }, { id: 2, body: `${GUARD_MARKER}\nold` }]) } as unknown as Octokit;
    const repo = { owner: "o", name: "r" } as Parameters<typeof upsertPrComment>[1];
    await upsertPrComment(gh, repo, 7, "new body");
    expect(rest.issues.updateComment).toHaveBeenCalledWith({ owner: "o", repo: "r", comment_id: 2, body: "new body" });
    expect(rest.issues.createComment).not.toHaveBeenCalled();
  });

  it("posts a commit status under one context with a short description", async () => {
    process.env.AUTH_URL = "https://boswell.example";
    const createCommitStatus = vi.fn();
    const gh = { rest: { repos: { createCommitStatus } } } as unknown as Octokit;
    await postStatus(gh, { owner: "o", name: "r" } as Parameters<typeof postStatus>[1], "abc", "failure", "x".repeat(200));
    expect(createCommitStatus).toHaveBeenCalledWith(
      expect.objectContaining({ sha: "abc", state: "failure", context: "Boswell / Ship Ready", target_url: "https://boswell.example/dashboard/ship-ready" }),
    );
    expect(createCommitStatus.mock.calls[0][0].description).toHaveLength(140);
  });
});

describe("queueGuardRun", () => {
  const repo = { id: "r1", userId: "u1" } as Parameters<typeof queueGuardRun>[0];
  beforeEach(() => Object.assign(db, { waiting: true, stillQueued: true, inserted: 0, updated: 0 }));

  it("points a still-queued run at the newest commit instead of queueing another", async () => {
    expect(await queueGuardRun(repo, { sha: "new", prNumber: 4 })).toBe("queued-run");
    expect(db.inserted).toBe(0);
  });

  it("queues a new run when the worker claimed the waiting one first", async () => {
    db.stillQueued = false;
    expect(await queueGuardRun(repo, { sha: "new", prNumber: 4 })).toBe("new-run");
    expect(db.updated).toBe(1);
    expect(db.inserted).toBe(1);
  });
});
