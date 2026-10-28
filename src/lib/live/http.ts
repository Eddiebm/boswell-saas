import { assertSafeStagingUrl } from "@/lib/dynamic-verify/validate-target";

const TIMEOUT_MS = 15_000;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;

export type LiveResponse = { url: string; status: number; headers: Headers; text: string; redirectedFrom: string[] };
export type LiveFetch = (url: string, init?: { headers?: Record<string, string> }) => Promise<LiveResponse>;

/**
 * GET-only fetch for the live checks. Every hop of a redirect chain is
 * re-validated against the SSRF guard (a public site can redirect to
 * 169.254.169.254), and bodies are capped so a huge response can't exhaust
 * the worker. `allowPrivate` exists for tests against a local server.
 */
export function createLiveFetch(options: { allowPrivate?: boolean } = {}): LiveFetch {
  return async (startUrl, init) => {
    let url = startUrl;
    const redirectedFrom: string[] = [];
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!options.allowPrivate) await assertSafeStagingUrl(url);
      const res = await fetch(url, { method: "GET", headers: init?.headers, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        redirectedFrom.push(url);
        url = new URL(location, url).toString();
        await res.body?.cancel();
        continue;
      }
      const reader = res.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_BYTES) {
          await reader.cancel();
          break;
        }
        chunks.push(value);
      }
      return { url, status: res.status, headers: res.headers, text: Buffer.concat(chunks).toString("utf8"), redirectedFrom };
    }
    throw new Error(`Too many redirects from ${startUrl}`);
  };
}
