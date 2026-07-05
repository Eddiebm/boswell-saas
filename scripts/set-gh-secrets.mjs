#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sodium from "tweetsodium";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repo = "Eddiebm/boswell-saas";
const pkPath = process.argv[2] || "/tmp/gh-pk.json";

function ghApi(args) {
  execFileSync("gh", ["api", ...args], { stdio: "inherit" });
}

function loadEnv() {
  const envPath = resolve(__dirname, "../.env.local");
  const text = readFileSync(envPath, "utf8");
  const env = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

const { key, key_id: keyId } = JSON.parse(readFileSync(pkPath, "utf8"));
const env = loadEnv();

function setSecret(name, value) {
  if (!value) {
    console.log(`Skip ${name}`);
    return;
  }
  const encryptedBytes = sodium.seal(Buffer.from(value, "utf8"), Buffer.from(key, "base64"));
  const encrypted = Buffer.from(encryptedBytes).toString("base64");
  ghApi([
    "-X",
    "PUT",
    `repos/${repo}/actions/secrets/${name}`,
    "-f",
    `encrypted_value=${encrypted}`,
    "-f",
    `key_id=${keyId}`,
  ]);
  console.log(`✓ ${name}`);
}

setSecret("DATABASE_URL", env.DATABASE_URL);
setSecret("OPENROUTER_API_KEY", env.OPENROUTER_API_KEY);
setSecret("OPENROUTER_MODEL", env.OPENROUTER_MODEL || "openrouter/auto");
setSecret(
  "BOSWELL_ENGINE_GIT_URL",
  env.BOSWELL_ENGINE_GIT_URL || "git+https://github.com/Eddiebm/boswell.git",
);

setSecret("ADMIN_ALERT_EMAIL", env.ADMIN_ALERT_EMAIL);
setSecret("RESEND_API_KEY", env.RESEND_API_KEY);
setSecret("ALERT_FROM_EMAIL", env.ALERT_FROM_EMAIL || "Boswell <onboarding@resend.dev>");

execFileSync("gh", ["workflow", "run", "audit-worker.yml", "--repo", repo], { stdio: "inherit" });
