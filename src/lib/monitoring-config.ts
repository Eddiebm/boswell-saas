/**
 * What every Sentry client may send. Boswell handles customer source code and
 * GitHub identities, so reports carry the error and its stack trace only —
 * nothing about the request, the user, or variables in scope.
 *
 * No imports: this file is shared by the browser, edge, server and worker
 * clients.
 */
export const SENTRY_DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  databaseQueryData: false,
  stackFrameVariables: false,
  genAI: { inputs: false, outputs: false },
};

/**
 * Credentials that can end up inside error text: a failed `git clone` puts
 * the whole command, token-bearing URL included, in its message.
 */
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[redacted]@"], // https://user:token@host
  [/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, "[redacted]"],
  [/\b(Bearer|token)\s+[A-Za-z0-9._~+/-]{16,}=*/gi, "$1 [redacted]"],
  [/\b(?:sk|rk)_(?:live|test)_[0-9a-zA-Z]{10,}\b/g, "[redacted]"],
  [/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}\b/g, "[redacted]"],
];

export function redactSecrets(text: string): string {
  return SECRET_PATTERNS.reduce((out, [re, replacement]) => out.replace(re, replacement), text);
}

/** Redacts every string in a Sentry event (messages, exception values, breadcrumbs) before it's sent. */
export function scrubEvent<T>(event: T): T {
  const scrub = (value: unknown, depth: number): unknown => {
    if (typeof value === "string") return redactSecrets(value);
    if (depth > 12 || value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = scrub(v, depth + 1);
    return out;
  };
  return scrub(event, 0) as T;
}
