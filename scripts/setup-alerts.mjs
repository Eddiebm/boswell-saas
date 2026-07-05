#!/usr/bin/env node
/**
 * Configure audit failure alerts (Resend email).
 *
 * Usage:
 *   ADMIN_ALERT_EMAIL=you@example.com node scripts/setup-alerts.mjs
 *   RESEND_API_KEY=re_... ADMIN_ALERT_EMAIL=you@example.com node scripts/setup-alerts.mjs
 */
import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const envPath = path.join(root, ".env.local");

function upsertEnv(key, value) {
  let text = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const line = `${key}=${value}`;
  if (new RegExp(`^${key}=`, "m").test(text)) {
    text = text.replace(new RegExp(`^${key}=.*$`, "m"), line);
  } else {
    text = text.trimEnd() + (text.endsWith("\n") || text.length === 0 ? "" : "\n") + line + "\n";
  }
  fs.writeFileSync(envPath, text);
}

async function validateResendKey(apiKey) {
  const response = await fetch("https://api.resend.com/api-keys", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    throw new Error(`Resend rejected the key (${response.status})`);
  }
}

const email = process.env.ADMIN_ALERT_EMAIL;
const resendKey = process.env.RESEND_API_KEY;

if (!email) {
  console.error("Set ADMIN_ALERT_EMAIL=your@email.com");
  process.exit(1);
}

upsertEnv("ADMIN_ALERT_EMAIL", email);
upsertEnv("ALERT_FROM_EMAIL", `"${process.env.ALERT_FROM_EMAIL ?? "Boswell <onboarding@resend.dev>"}"`);

if (resendKey) {
  await validateResendKey(resendKey);
  upsertEnv("RESEND_API_KEY", resendKey);
  console.log("Resend API key validated.");
} else {
  console.log("No RESEND_API_KEY — email saved; add key at https://resend.com/api-keys then re-run.");
}

console.log("Pushing env to Vercel...");
execSync("bash scripts/push-vercel-env-api.sh", { cwd: root, stdio: "inherit" });

if (resendKey) {
  console.log("Pushing secrets to GitHub Actions...");
  execSync("npm run deploy:worker", { cwd: root, stdio: "inherit" });
}

console.log(`Alerts configured for ${email}`);
