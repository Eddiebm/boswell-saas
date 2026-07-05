#!/usr/bin/env node
/**
 * Production smoke test for boswell-saas.
 * Usage: node scripts/smoke-test-production.mjs
 * Optional: BASE_URL=https://boswell-saas.vercel.app
 */

const BASE_URL = process.env.BASE_URL ?? "https://boswell-saas.vercel.app";

const checks = [];

async function check(name, fn) {
  try {
    const detail = await fn();
    checks.push({ name, ok: true, detail });
    console.log(`✓ ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    checks.push({ name, ok: false, detail: message });
    console.error(`✗ ${name} — ${message}`);
  }
}

async function fetchStatus(path, init) {
  const res = await fetch(`${BASE_URL}${path}`, init);
  return res.status;
}

await check("Landing page returns 200", async () => {
  const status = await fetchStatus("/");
  if (status !== 200) throw new Error(`expected 200, got ${status}`);
  return String(status);
});

await check("Login page returns 200", async () => {
  const status = await fetchStatus("/login");
  if (status !== 200) throw new Error(`expected 200, got ${status}`);
  return String(status);
});

await check("Dashboard redirects unauthenticated users", async () => {
  const res = await fetch(`${BASE_URL}/dashboard`, { redirect: "manual" });
  if (![307, 302, 303].includes(res.status)) {
    throw new Error(`expected redirect, got ${res.status}`);
  }
  return String(res.status);
});

await check("POST /api/audits requires auth", async () => {
  const status = await fetchStatus("/api/audits", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repositoryId: "test" }),
  });
  if (status !== 401) throw new Error(`expected 401, got ${status}`);
  return String(status);
});

await check("POST /api/worker/tick requires secret", async () => {
  const status = await fetchStatus("/api/worker/tick", { method: "POST" });
  if (status !== 401) throw new Error(`expected 401, got ${status}`);
  return String(status);
});

await check("POST /api/brain requires auth", async () => {
  const status = await fetchStatus("/api/brain", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question: "test" }),
  });
  if (status !== 401) throw new Error(`expected 401, got ${status}`);
  return String(status);
});

try {
  const { execFileSync } = await import("node:child_process");
  await check("GitHub Actions worker recent run succeeded", async () => {
    const out = execFileSync(
      "gh",
      [
        "api",
        "repos/Eddiebm/boswell-saas/actions/workflows/audit-worker.yml/runs",
        "--jq",
        ".workflow_runs[0] | \"\\(.status) \\(.conclusion // \"pending\")\"",
      ],
      { encoding: "utf8" },
    ).trim();
    if (!out.startsWith("completed success")) {
      throw new Error(`latest run: ${out}`);
    }
    return out;
  });
} catch {
  console.log("· skipped GitHub Actions check (gh CLI unavailable)");
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);

if (failed.length) {
  process.exit(1);
}
