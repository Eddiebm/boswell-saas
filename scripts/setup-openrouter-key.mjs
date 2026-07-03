#!/usr/bin/env node
/**
 * Validate an OpenRouter API key, save to .env.local, push to Vercel + GitHub Actions.
 *
 * Usage:
 *   OPENROUTER_API_KEY=sk-or-v1-... node scripts/setup-openrouter-key.mjs
 *   npm run setup:openrouter-key
 */
import { execFileSync, execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const envPath = path.join(root, ".env.local");

function reservePort(preferred = 3848) {
  return new Promise((resolve, reject) => {
    const tryPort = (port) => {
      const probe = net.createServer();
      probe.once("error", (error) => {
        if (error.code === "EADDRINUSE" && port === preferred) {
          tryPort(preferred + 1);
          return;
        }
        reject(error);
      });
      probe.listen(port, "127.0.0.1", () => {
        probe.close(() => resolve(port));
      });
    };
    tryPort(preferred);
  });
}

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

async function validateKey(apiKey) {
  const response = await fetch("https://openrouter.ai/api/v1/auth/key", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const body = await response.json();
  if (!response.ok || body.error) {
    throw new Error(body.error?.message || `OpenRouter rejected the key (${response.status})`);
  }
  return body.data;
}

function deploy(key) {
  upsertEnv("OPENROUTER_API_KEY", key);
  if (!process.env.OPENROUTER_MODEL) {
    upsertEnv("OPENROUTER_MODEL", "openrouter/auto");
  }

  console.log("Pushing env to Vercel...");
  execSync("bash scripts/push-vercel-env-api.sh", { cwd: root, stdio: "inherit" });

  console.log("Pushing secrets to GitHub Actions...");
  execSync("npm run deploy:worker", { cwd: root, stdio: "inherit" });

  console.log("Re-queueing latest failed audit...");
  execFileSync(
    "npx",
    [
      "tsx",
      "-e",
      `import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
await sql\`UPDATE audit_runs SET status = 'queued', error = NULL, started_at = NULL, finished_at = NULL WHERE status = 'failed' ORDER BY created_at DESC LIMIT 1\`;
console.log('Re-queued latest failed audit');`,
    ],
    { cwd: root, stdio: "inherit", env: { ...process.env } },
  );
}

async function promptInBrowser(port) {
  const token = crypto.randomBytes(16).toString("hex");

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        if (req.method === "GET" && req.url === "/") {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`<!doctype html>
<html><head><meta charset="utf-8"><title>Boswell OpenRouter setup</title>
<style>body{font-family:system-ui;max-width:640px;margin:48px auto;padding:0 16px}
input,button{width:100%;font-size:16px;padding:12px;margin:8px 0}
code{background:#f4f4f5;padding:2px 6px;border-radius:4px}</style></head>
<body>
<h1>Boswell OpenRouter setup</h1>
<ol>
<li>Sign in at <a href="https://openrouter.ai/keys" target="_blank">openrouter.ai/keys</a></li>
<li>Click <strong>Create Key</strong></li>
<li>Paste the key below (starts with <code>sk-or-v1-</code>)</li>
</ol>
<form method="POST" action="/save">
<input type="hidden" name="token" value="${token}" />
<input name="key" placeholder="sk-or-v1-..." required autocomplete="off" />
<button type="submit">Save & deploy</button>
</form>
</body></html>`);
          return;
        }

        if (req.method === "POST" && req.url === "/save") {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const body = Buffer.concat(chunks).toString("utf8");
          const params = new URLSearchParams(body);
          if (params.get("token") !== token) {
            res.writeHead(403, { "Content-Type": "text/plain" });
            res.end("Invalid token");
            return;
          }
          const key = (params.get("key") || "").trim();
          await validateKey(key);
          deploy(key);
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end("<h1>Done</h1><p>OpenRouter key saved to .env.local, Vercel, and GitHub Actions. You can close this tab.</p>");
          server.close(() => resolve(key));
          return;
        }

        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
      } catch (error) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end(error instanceof Error ? error.message : String(error));
      }
    });

    server.listen(port, "127.0.0.1", () => {
      const url = `http://127.0.0.1:${port}/`;
      console.log(`Open ${url} and paste your OpenRouter key.`);
      try {
        const cmd =
          process.platform === "darwin"
            ? `open "${url}"`
            : process.platform === "win32"
              ? `start "" "${url}"`
              : `xdg-open "${url}"`;
        execSync(cmd);
      } catch {
        // ignore browser open failures
      }
    });

    server.on("error", reject);
  });
}

async function main() {
  const fromArg = (process.argv[2] || process.env.OPENROUTER_NEW_KEY || "").trim();
  if (fromArg) {
    console.log("Validating OpenRouter key...");
    const meta = await validateKey(fromArg);
    console.log(`Key ok (${meta.label || "unnamed"}, usage: ${meta.usage ?? "n/a"})`);
    deploy(fromArg);
    console.log("Done.");
    return;
  }

  const port = await reservePort();
  await promptInBrowser(port);
  console.log("Done.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
