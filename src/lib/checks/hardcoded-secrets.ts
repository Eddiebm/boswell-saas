import { isEnvExample, isTestFile } from "@/lib/checks/collect-files";
import { lineOf, type CheckFinding, type RepoFile } from "@/lib/checks/types";

/**
 * Key formats that are only ever secret. Public-by-design keys (Firebase web
 * config `AIza…`, Stripe `pk_`, Supabase anon JWTs) are deliberately absent.
 */
const PATTERNS: Array<{ name: string; re: RegExp; rotate: string }> = [
  { name: "Stripe live secret key", re: /\b(?:sk|rk)_live_[0-9a-zA-Z]{20,}\b/g, rotate: "Stripe Dashboard → Developers → API keys → roll key" },
  { name: "OpenAI API key", re: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{40,}\b/g, rotate: "platform.openai.com → API keys → revoke" },
  { name: "Anthropic API key", re: /\bsk-ant-[A-Za-z0-9_-]{30,}\b/g, rotate: "console.anthropic.com → API keys → revoke" },
  { name: "AWS access key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, rotate: "AWS IAM → the user's security credentials → deactivate and delete the key" },
  { name: "GitHub token", re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/g, rotate: "GitHub → Settings → Developer settings → tokens → delete" },
  { name: "Slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, rotate: "api.slack.com/apps → your app → reinstall to rotate tokens" },
  { name: "Resend API key", re: /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}\b/g, rotate: "resend.com → API Keys → delete" },
  { name: "private key", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g, rotate: "generate a new key pair and revoke the old public key wherever it's trusted" },
];

/** A connection string with an inline password that isn't an obvious placeholder or a local dev database. */
const DB_URL = /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|rediss):\/\/([^:\s"'`/]+):([^@\s"'`]+)@([^/\s"'`:]+)/g;
const PLACEHOLDER = /^(?:password|pass|secret|changeme|postgres|root|example|your[-_]?\w*|xxx+|\*+|<.*>|\$\{.*\}|\[.*\])$/i;
const LOCAL_HOST = /^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|db|postgres|mysql|redis|host\.docker\.internal)$/i;

const REAL_ENV_FILE = /(^|\/)\.env(?:\.(?:local|production|development|production\.local|development\.local))?$/;

/** Enough to tell which key it is, never enough to use or narrow it down. */
function mask(value: string) {
  return `${value.slice(0, 4)}… (${value.length} chars)`;
}

/** JWTs whose payload says `"role": "service_role"` — Supabase's key that bypasses every row-level security rule. */
function serviceRoleJwts(content: string): Array<{ index: number; token: string }> {
  const out: Array<{ index: number; token: string }> = [];
  for (const m of content.matchAll(/\beyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}\b/g)) {
    try {
      const payload = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8")) as { role?: string };
      if (payload.role === "service_role") out.push({ index: m.index, token: m[0] });
    } catch {
      /* not a JWT */
    }
  }
  return out;
}

export type SecretHit = { name: string; index: number; value: string; rotate: string };

/** Every live-looking credential in a piece of text. Shared by the working-tree and git-history scans. */
export function findSecrets(content: string): SecretHit[] {
  const hits: SecretHit[] = [];
  for (const p of PATTERNS) {
    for (const m of content.matchAll(p.re)) hits.push({ name: p.name, index: m.index, value: m[0], rotate: p.rotate });
  }
  for (const jwt of serviceRoleJwts(content)) {
    hits.push({ name: "Supabase service-role key", index: jwt.index, value: jwt.token, rotate: "Supabase → Project Settings → API → generate new JWT secret (this rotates every key)" });
  }
  for (const m of content.matchAll(DB_URL)) {
    if (PLACEHOLDER.test(m[2]) || LOCAL_HOST.test(m[3])) continue;
    hits.push({ name: "database password", index: m.index, value: m[2], rotate: "reset the database user's password with your database provider" });
  }
  return hits;
}

export function maskSecret(value: string) {
  return mask(value);
}

/**
 * Live credentials written into the repository. Anyone who can read the repo
 * (or a leaked copy, or its git history) can use them — deleting the line
 * later doesn't help, so every finding says to rotate the key.
 */
export function checkHardcodedSecrets(files: RepoFile[]): CheckFinding[] {
  const out: CheckFinding[] = [];
  const committedEnv: RepoFile[] = [];

  for (const f of files) {
    if (isEnvExample(f) || f.path.endsWith("package-lock.json")) continue;
    if (REAL_ENV_FILE.test(f.path)) {
      if (/^\s*[A-Z][A-Z0-9_]*\s*=\s*\S/m.test(f.content)) committedEnv.push(f);
      continue;
    }
    // Tests and fixtures are full of fake credentials shaped like real ones.
    if (isTestFile(f)) continue;

    const hits = findSecrets(f.content);

    for (const hit of hits.slice(0, 5)) {
      out.push({
        ruleId: "secrets.hardcoded",
        severity: "CRITICAL",
        category: "secrets",
        title: `${hit.name[0].toUpperCase()}${hit.name.slice(1)} committed in code`,
        description: `\`${f.path}\` contains what looks like a live ${hit.name} (\`${mask(hit.value)}\`). Anyone who can see this repository — or any copy of it, including its git history — can use it.`,
        filePath: f.path,
        lineStart: lineOf(f.content, hit.index),
        recommendation: `Rotate it now (${hit.rotate}), then move the new value into an environment variable and read it with \`process.env\`. Removing the line isn't enough: the old key stays in git history.`,
        confidence: 0.9,
      });
    }
  }

  for (const f of committedEnv) {
    const names = [...f.content.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*\S/gm)].map((m) => m[1]);
    out.push({
      ruleId: "secrets.hardcoded",
      severity: names.some((n) => /SECRET|KEY|TOKEN|PASSWORD|DATABASE_URL|PRIVATE/.test(n)) ? "CRITICAL" : "HIGH",
      category: "secrets",
      title: `${f.path} is committed to the repository`,
      description: `Environment files hold the app's real credentials and should never be committed. This one sets ${names.length} ${names.length === 1 ? "variable" : "variables"}: ${names.slice(0, 10).map((n) => `\`${n}\``).join(", ")}${names.length > 10 ? ", …" : ""}.`,
      filePath: f.path,
      recommendation: `Rotate every secret in it, delete the file from the repo (\`git rm --cached ${f.path}\`), add \`.env*\` to \`.gitignore\` (keeping \`.env.example\`), and set the values in your hosting provider's environment settings instead.`,
      confidence: 0.95,
    });
  }
  return out;
}
