#!/usr/bin/env node
/**
 * Local form to paste GitHub OAuth Client ID + Secret → .env.local + Vercel.
 * Run: node scripts/apply-github-oauth.mjs
 * Then open http://localhost:3456
 */
import http from "node:http";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const envPath = resolve(root, ".env.local");
const PORT = 3456;

function setEnvKey(text, key, value) {
  const line = `${key}=${value}`;
  if (new RegExp(`^${key}=`, "m").test(text)) {
    return text.replace(new RegExp(`^${key}=.*$`, "m"), line);
  }
  return `${text.trim()}\n${line}\n`;
}

function pushToVercel() {
  const authFile = `${process.env.HOME}/Library/Application Support/com.vercel.cli/auth.json`;
  const env = Object.fromEntries(
    readFileSync(envPath, "utf8")
      .split("\n")
      .filter((l) => l.includes("=") && !l.startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i), l.slice(i + 1)];
      }),
  );
  const token = JSON.parse(readFileSync(authFile, "utf8")).token;
  const projectId = "prj_SOwP5saiF2YFESAd0CjLWzqgfJ0Z";
  const teamId = "team_xEdbPPlzZmOVGOxap6gPbbW2";

  for (const key of ["AUTH_GITHUB_ID", "AUTH_GITHUB_SECRET"]) {
    const value = env[key];
    if (!value) continue;
    const payload = JSON.stringify({
      key,
      value,
      type: "encrypted",
      target: ["production", "preview", "development"],
    });
    execFileSync(
      "curl",
      [
        "-sf",
        "-X",
        "POST",
        "-H",
        `Authorization: Bearer ${token}`,
        "-H",
        "Content-Type: application/json",
        `https://api.vercel.com/v10/projects/${projectId}/env?teamId=${teamId}&upsert=true`,
        "-d",
        payload,
      ],
      { stdio: "inherit" },
    );
    console.log(`Vercel: ${key}`);
  }
  execFileSync("vercel", ["--prod", "--yes", "--scope", "eddiebms-projects"], {
    cwd: root,
    stdio: "inherit",
  });
}

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Boswell GitHub OAuth</title>
<style>
  body{font-family:system-ui;max-width:520px;margin:40px auto;padding:0 20px;background:#111;color:#eee}
  h1{font-size:1.25rem} label{display:block;margin-top:16px;font-size:.85rem;color:#aaa}
  input{width:100%;padding:10px;margin-top:6px;border:1px solid #333;border-radius:8px;background:#222;color:#fff;box-sizing:border-box}
  button{margin-top:20px;width:100%;padding:12px;background:#fff;color:#000;border:none;border-radius:8px;font-weight:600;cursor:pointer}
  .hint{font-size:.8rem;color:#888;margin-top:24px;line-height:1.5}
  .ok{color:#6ee7b7;margin-top:16px}
</style></head><body>
<h1>Paste GitHub OAuth credentials</h1>
<p class="hint">From your open GitHub tab after clicking <strong>Register application</strong>:
copy <strong>Client ID</strong> and generate/copy <strong>Client secret</strong>.</p>
<form method="POST" action="/save">
  <label>Client ID (AUTH_GITHUB_ID)</label>
  <input name="client_id" required placeholder="Ov23li..." autocomplete="off" />
  <label>Client secret (AUTH_GITHUB_SECRET)</label>
  <input name="client_secret" required type="password" placeholder="ghp_ or hex secret" autocomplete="off" />
  <button type="submit">Save & deploy to Vercel</button>
</form>
</body></html>`;

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
    return;
  }

  if (req.method === "POST" && req.url === "/save") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks).toString();
    const params = new URLSearchParams(body);
    const clientId = params.get("client_id")?.trim();
    const clientSecret = params.get("client_secret")?.trim();

    if (!clientId || !clientSecret) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Missing client_id or client_secret");
      return;
    }

    let text = readFileSync(envPath, "utf8");
    text = setEnvKey(text, "AUTH_GITHUB_ID", clientId);
    text = setEnvKey(text, "AUTH_GITHUB_SECRET", clientSecret);
    writeFileSync(envPath, text);

    try {
      pushToVercel();
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        `<html><body style="font-family:system-ui;background:#111;color:#eee;padding:40px">
        <p class="ok">✓ Saved and deployed!</p>
        <p><a style="color:#6ee7b7" href="https://boswell-saas.vercel.app/login">Test sign-in →</a></p>
        <p style="color:#888;font-size:.85rem">You can close this tab. Server will exit in 3s.</p>
        </body></html>`,
      );
      setTimeout(() => process.exit(0), 3000);
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end(`Deploy failed: ${err}`);
    }
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`Open http://localhost:${PORT}`);
  try {
    execFileSync("open", [`http://localhost:${PORT}`]);
  } catch {
    /* headless */
  }
});
