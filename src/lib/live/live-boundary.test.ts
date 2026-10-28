import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLiveFetch } from "@/lib/live/http";
import { browserDestinationAllowed, runSmoke } from "@/lib/live/smoke";

/**
 * What the live checks may touch. Two local servers: the "site" on 127.0.0.1
 * (allowed in tests) and an "internal service" on 127.0.0.2 that nothing
 * should ever reach, plus a stand-in for a third-party origin.
 */
type Hit = { method: string; url: string; cookie?: string; authorization?: string };
const siteHits: Hit[] = [];
const internalHits: Hit[] = [];
let site: http.Server;
let internal: http.Server;
let siteUrl = "";
let internalUrl = "";

function listen(server: http.Server, host: string) {
  return new Promise<string>((resolve) => server.listen(0, host, () => resolve(`http://${host}:${(server.address() as AddressInfo).port}`)));
}

beforeAll(async () => {
  internal = http.createServer((req, res) => {
    internalHits.push({ method: req.method ?? "", url: req.url ?? "", cookie: req.headers.cookie, authorization: req.headers.authorization });
    res.end("internal");
  });
  internalUrl = await listen(internal, "127.0.0.2");
  site = http.createServer((req, res) => {
    siteHits.push({ method: req.method ?? "", url: req.url ?? "", cookie: req.headers.cookie });
    const html = (body: string) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(`<html><body>${body}</body></html>`);
    };
    switch (req.url) {
      case "/mutates-on-load":
        return html(`<script>
          fetch("/api/delete-everything", { method: "POST" }).catch(() => {});
          fetch("/api/profile", { method: "DELETE" }).catch(() => {});
          fetch("/api/read").catch(() => {});
        </script>`);
      case "/reaches-inside":
        return html(`<img src="${internalUrl}/direct"><script>fetch("/bounce").catch(() => {}); fetch("http://[::1]:1/ipv6").catch(() => {});</script>`);
      case "/bounce":
        res.writeHead(302, { location: `${internalUrl}/redirected` });
        return res.end();
      case "/to-third-party":
        res.writeHead(302, { location: `${internalUrl}/collect` });
        return res.end();
      default:
        return html("ok");
    }
  });
  siteUrl = await listen(site, "127.0.0.1");
});
afterAll(async () => {
  await new Promise((r) => site.close(r));
  await new Promise((r) => internal.close(r));
});

describe("browserDestinationAllowed", () => {
  const lookup = (map: Record<string, string[]>) => async (host: string) => (map[host] ?? []).map((address) => ({ address }));

  it("blocks names that resolve to private addresses, and bracketed IPv6 literals", async () => {
    const dns = lookup({ "public.example": ["93.184.215.14"], "sneaky.example": ["93.184.215.14", "10.0.0.5"], "meta.example": ["169.254.169.254"] });
    expect(await browserDestinationAllowed("https://public.example/x", { lookup: dns })).toBe(true);
    expect(await browserDestinationAllowed("https://sneaky.example/x", { lookup: dns })).toBe(false);
    expect(await browserDestinationAllowed("http://meta.example/latest", { lookup: dns })).toBe(false);
    expect(await browserDestinationAllowed("http://unresolvable.example/", { lookup: dns })).toBe(false);
    expect(await browserDestinationAllowed("http://[::1]:3000/", { lookup: dns })).toBe(false);
    expect(await browserDestinationAllowed("http://[fd00::1]/", { lookup: dns })).toBe(false);
    expect(await browserDestinationAllowed("http://[::ffff:127.0.0.1]/", { lookup: dns })).toBe(false);
    expect(await browserDestinationAllowed("http://app.localhost/", { lookup: dns })).toBe(false);
    expect(await browserDestinationAllowed("file:///etc/passwd", { lookup: dns })).toBe(false);
  });

  it("lets tests reach their own server and nothing else private", async () => {
    expect(await browserDestinationAllowed("http://127.0.0.1:8080/", { allowHost: "127.0.0.1" })).toBe(true);
    expect(await browserDestinationAllowed("http://127.0.0.2:8080/", { allowHost: "127.0.0.1" })).toBe(false);
  });
});

describe("live fetch redirects", () => {
  it("drops the test session's credentials when a redirect leaves the site", async () => {
    internalHits.length = 0;
    const res = await createLiveFetch({ allowPrivate: true })(`${siteUrl}/to-third-party`, { headers: { Cookie: "session=b", Authorization: "Bearer t", Accept: "application/json" } });
    expect(res.url).toBe(`${internalUrl}/collect`);
    expect(internalHits).toEqual([{ method: "GET", url: "/collect", cookie: undefined, authorization: undefined }]);
  });

  it("keeps them on same-origin redirects", async () => {
    siteHits.length = 0;
    await createLiveFetch({ allowPrivate: true })(`${siteUrl}/`, { headers: { Cookie: "session=b" } });
    expect(siteHits.at(-1)?.cookie).toBe("session=b");
  });
});

const browserAvailable = Boolean(process.env.PLAYWRIGHT_BROWSERS_PATH || process.env.BOSWELL_CHROMIUM_PATH);

describe.runIf(browserAvailable)("browser boundary", () => {
  it("aborts anything but reads that a page sends on load, and keeps the session on reads", async () => {
    siteHits.length = 0;
    const result = await runSmoke({ baseUrl: siteUrl, pages: ["/mutates-on-load"], allowPrivate: true, session: { cookie: "session=b" } });
    expect(result.ran).toBe(true);
    expect(siteHits.filter((h) => h.method !== "GET" && h.method !== "HEAD" && h.method !== "OPTIONS")).toEqual([]);
    const read = siteHits.find((h) => h.url === "/api/read");
    expect(read).toBeDefined();
    expect(read?.cookie).toBe("session=b");
  }, 60_000);

  it("never reaches private addresses — directly, through a redirect, or by IPv6 literal", async () => {
    internalHits.length = 0;
    siteHits.length = 0;
    await runSmoke({ baseUrl: siteUrl, pages: ["/reaches-inside"], allowPrivate: true });
    expect(siteHits.some((h) => h.url === "/bounce")).toBe(true);
    expect(internalHits).toEqual([]);
  }, 60_000);
});
