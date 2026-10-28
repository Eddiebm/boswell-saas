import type { RepoFile } from "@/lib/checks/types";

export type RouteInfo = { path: string; file: string; dynamic: boolean };

/** `app/(marketing)/blog/[slug]/page.tsx` → `/blog/[slug]`; route groups and private folders don't appear in URLs. */
function appPath(file: string, leaf: RegExp): string | null {
  const m = /(?:^|\/)app\/(.*?)\/?(?:page|route)\.[jt]sx?$/.exec(file);
  if (!m || !leaf.test(file)) return null;
  const segments = m[1].split("/").filter(Boolean);
  if (segments.some((s) => s.startsWith("_") || s.startsWith("@"))) return null;
  return "/" + segments.filter((s) => !/^\(.*\)$/.test(s)).join("/");
}

function pagesPath(file: string): string | null {
  const m = /(?:^|\/)pages\/(.*)\.[jt]sx?$/.exec(file);
  if (!m || /(^|\/)_(?:app|document|error)$/.test(m[1])) return null;
  return "/" + m[1].replace(/(^|\/)index$/, "");
}

/** Pages and API routes the app serves, read from Next.js file conventions. */
export function extractRoutes(files: RepoFile[]): { pages: RouteInfo[]; api: RouteInfo[] } {
  const pages: RouteInfo[] = [];
  const api: RouteInfo[] = [];
  for (const f of files) {
    if (/node_modules\//.test(f.path)) continue;
    const page = appPath(f.path, /\/page\.[jt]sx?$/) ?? (f.path.includes("pages/api/") ? null : pagesPath(f.path));
    const route = appPath(f.path, /\/route\.[jt]sx?$/) ?? (f.path.includes("pages/api/") ? pagesPath(f.path) : null);
    if (page !== null) pages.push({ path: page.replace(/\/$/, "") || "/", file: f.path, dynamic: page.includes("[") });
    if (route !== null) api.push({ path: route.replace(/\/$/, "") || "/", file: f.path, dynamic: route.includes("[") });
  }
  const byPath = (a: RouteInfo, b: RouteInfo) => a.path.localeCompare(b.path);
  return { pages: pages.sort(byPath), api: api.sort(byPath) };
}

/** Whether a route handler file exports a GET handler (the only method the live sweep uses). */
export function hasGetHandler(file: RepoFile): boolean {
  return /export\s+(?:async\s+)?function\s+GET\b|export\s+const\s+GET\b|export\s*\{[^}]*\bGET\b/.test(file.content) || /pages\/api\//.test(file.path);
}
