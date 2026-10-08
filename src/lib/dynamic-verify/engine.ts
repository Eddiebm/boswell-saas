/**
 * Live access-control verification (beta).
 *
 * Proves — against a real, running staging instance, not by reading source —
 * whether one account can read another account's resource. This is
 * deliberately narrow: it logs in as two accounts the customer already
 * created and owns, then issues a single GET as account B for a resource
 * id known to belong to account A. It never signs up new accounts, never
 * issues a mutating request against the target, and never persists the
 * response body — only a status code and which known-sensitive fields (if
 * any) leaked into it.
 */

export type VerifyTargetConfig = {
  stagingUrl: string;
  loginPath: string;
  accountAEmail: string;
  accountAPassword: string;
  accountBEmail: string;
  accountBPassword: string;
  resourcePathTemplate: string;
  accountAResourceId: string;
};

export type VerifyCheckResult = {
  result: "leak_confirmed" | "no_leak" | "inconclusive";
  httpStatus: number | null;
  matchedFields: string[];
  summary: string;
};

type Session = { cookie?: string; bearer?: string };

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Resolves a path against the staging origin and refuses to leave it. A
 * loginPath/resourcePathTemplate is attacker-controlled input — if it were
 * itself an absolute URL, `new URL(path, base)` would silently ignore
 * `base` and resolve to that other host instead.
 */
function resolveUrl(base: string, pathOrTemplate: string, id?: string) {
  const resolvedPath = id ? pathOrTemplate.replace("{id}", encodeURIComponent(id)) : pathOrTemplate;
  const url = new URL(resolvedPath, base);
  const baseOrigin = new URL(base).origin;
  if (url.origin !== baseOrigin) {
    throw new Error(
      `Resolved URL origin (${url.origin}) does not match the staging origin (${baseOrigin}) — refusing to request it`,
    );
  }
  return url.toString();
}

async function login(config: VerifyTargetConfig, email: string, password: string): Promise<Session> {
  const url = resolveUrl(config.stagingUrl, config.loginPath);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    redirect: "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const cookie = res.headers.get("set-cookie") ?? undefined;
  let bearer: string | undefined;
  try {
    const body = (await res.clone().json()) as Record<string, unknown>;
    const tokenValue = body.token ?? body.accessToken ?? body.access_token ?? body.jwt;
    if (typeof tokenValue === "string") bearer = tokenValue;
  } catch {
    /* response wasn't JSON — cookie session is fine on its own */
  }

  if (!cookie && !bearer) {
    throw new Error(
      `Login failed for ${email} against ${config.loginPath} (status ${res.status}): no session cookie or bearer token returned`,
    );
  }

  return { cookie: cookie?.split(";")[0], bearer };
}

function sessionHeaders(session: Session): HeadersInit {
  const headers: Record<string, string> = {};
  if (session.cookie) headers.Cookie = session.cookie;
  if (session.bearer) headers.Authorization = `Bearer ${session.bearer}`;
  return headers;
}

/** GET only — this function must never issue a mutating request. */
async function fetchResourceAsGet(url: string, session: Session): Promise<{ status: number; text: string }> {
  const res = await fetch(url, {
    method: "GET",
    headers: sessionHeaders(session),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  return { status: res.status, text };
}

export async function runAccessControlCheck(config: VerifyTargetConfig): Promise<VerifyCheckResult> {
  const sessionA = await login(config, config.accountAEmail, config.accountAPassword);
  const resourceUrl = resolveUrl(config.stagingUrl, config.resourcePathTemplate, config.accountAResourceId);

  const baseline = await fetchResourceAsGet(resourceUrl, sessionA);
  if (baseline.status < 200 || baseline.status >= 300) {
    return {
      result: "inconclusive",
      httpStatus: baseline.status,
      matchedFields: [],
      summary: `Could not establish a baseline: account A got status ${baseline.status} fetching its own resource. Check resourcePathTemplate and accountAResourceId.`,
    };
  }

  const sessionB = await login(config, config.accountBEmail, config.accountBPassword);
  const crossAccount = await fetchResourceAsGet(resourceUrl, sessionB);

  if (crossAccount.status === 401 || crossAccount.status === 403 || crossAccount.status === 404) {
    return {
      result: "no_leak",
      httpStatus: crossAccount.status,
      matchedFields: [],
      summary: `Account B was denied (status ${crossAccount.status}) when requesting account A's resource. Access control held.`,
    };
  }

  if (crossAccount.status >= 200 && crossAccount.status < 300) {
    const matchedFields: string[] = [];
    if (crossAccount.text.toLowerCase().includes(config.accountAEmail.toLowerCase())) {
      matchedFields.push("account_a_email");
    }

    if (matchedFields.length > 0) {
      return {
        result: "leak_confirmed",
        httpStatus: crossAccount.status,
        matchedFields,
        summary:
          "Account B received a 2xx response containing account A's email when requesting account A's resource. This is a live, proven cross-account access-control leak.",
      };
    }

    return {
      result: "inconclusive",
      httpStatus: crossAccount.status,
      matchedFields: [],
      summary: `Account B got status ${crossAccount.status} but the response did not contain any field known to belong to account A — cannot confirm whether this is a leak or a generic/empty response.`,
    };
  }

  return {
    result: "inconclusive",
    httpStatus: crossAccount.status,
    matchedFields: [],
    summary: `Unexpected status ${crossAccount.status} from account B's request — not a clear allow or deny.`,
  };
}
