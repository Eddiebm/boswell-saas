#!/usr/bin/env node
/**
 * Create a GitHub App via manifest flow and write OAuth credentials for NextAuth.
 * Opens the user's browser once — they click "Create" on GitHub.
 */
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const envPath = path.join(root, ".env.local");

function reservePort(preferred = 3847) {
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

function openBrowser(target) {
  const cmd =
    process.platform === "darwin"
      ? `open "${target}"`
      : process.platform === "win32"
        ? `start "" "${target}"`
        : `xdg-open "${target}"`;
  execSync(cmd);
}

function exchangeCode(code) {
  const out = execSync(`gh api -X POST "/app-manifests/${code}/conversions"`, {
    encoding: "utf8",
  });
  return JSON.parse(out);
}

async function main() {
  const PORT = await reservePort();
  const STATE = crypto.randomBytes(16).toString("hex");
  const REDIRECT = `http://localhost:${PORT}/callback`;

  const manifest = {
    name: `boswell-saas-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`,
    url: "https://boswell-saas.vercel.app",
    description: "Boswell Cloud — repo audits and engineering memory",
    redirect_url: REDIRECT,
    callback_urls: [
      "https://boswell-saas.vercel.app/api/auth/callback/github",
      "http://localhost:3000/api/auth/callback/github",
    ],
    public: false,
    request_oauth_on_install: true,
    default_permissions: {
      metadata: "read",
      contents: "read",
    },
    default_events: [],
  };

  console.log("Creating GitHub App for Boswell OAuth…");
  console.log("A browser tab will open — click Create on GitHub.\n");

  const htmlPath = path.join(__dirname, "github-oauth-setup.html");
  const manifestJson = JSON.stringify(manifest).replace(/'/g, "&#39;");
  fs.writeFileSync(
    htmlPath,
    `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Boswell GitHub App</title></head>
<body>
<p>Redirecting to GitHub to create the Boswell app…</p>
<form id="f" method="post" action="https://github.com/settings/apps/new?state=${STATE}">
  <input type="hidden" name="manifest" value='${manifestJson}' />
</form>
<script>document.getElementById('f').submit();</script>
</body></html>`,
  );

  await new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);

        if (url.pathname === "/" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(fs.readFileSync(htmlPath, "utf8"));
          return;
        }

        if (url.pathname !== "/callback") {
          res.writeHead(404);
          res.end("Not found");
          return;
        }

        if (url.searchParams.get("state") !== STATE) {
          res.writeHead(400);
          res.end("Invalid state");
          reject(new Error("OAuth manifest state mismatch"));
          return;
        }

        const code = url.searchParams.get("code");
        if (!code) {
          res.writeHead(400);
          res.end("Missing code");
          reject(new Error("GitHub did not return a manifest code"));
          return;
        }

        const app = exchangeCode(code);
        const clientId = app.client_id;
        const clientSecret = app.client_secret;

        if (!clientId || !clientSecret) {
          throw new Error("GitHub App created but missing client_id/client_secret");
        }

        upsertEnv("AUTH_GITHUB_ID", clientId);
        upsertEnv("AUTH_GITHUB_SECRET", clientSecret);

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          `<html><body style="font-family:system-ui;padding:2rem">
            <h1>Boswell GitHub App created</h1>
            <p>Client ID saved to <code>.env.local</code>.</p>
            <p>You can close this tab.</p>
          </body></html>`,
        );

        console.log("GitHub App created:");
        console.log(`  slug: ${app.slug}`);
        console.log(`  app_id: ${app.id}`);
        console.log(`  client_id: ${clientId}`);
        console.log("  client_secret: (saved to .env.local)");

        console.log("\nPushing to Vercel…");
        try {
          execSync("bash scripts/push-vercel-env-api.sh", { cwd: root, stdio: "inherit" });
        } catch {
          console.warn("Vercel push failed — run: bash scripts/push-vercel-env-api.sh");
        }

        server.close();
        resolve(app);
      } catch (error) {
        res.writeHead(500);
        res.end("Setup failed — check terminal");
        server.close();
        reject(error);
      }
    });

    server.listen(PORT, "127.0.0.1", () => {
      const startUrl = `http://127.0.0.1:${PORT}/`;
      console.log(`Open this URL and click Create on GitHub:\n  ${startUrl}\n`);
      try {
        openBrowser(startUrl);
      } catch {
        console.log("Could not auto-open browser — open the URL above manually.");
      }
      console.log(`Waiting for GitHub callback on ${REDIRECT} …`);
    });

    server.on("error", reject);
    setTimeout(() => {
      server.close();
      reject(new Error("Timed out waiting for GitHub (5 minutes)"));
    }, 5 * 60 * 1000);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
