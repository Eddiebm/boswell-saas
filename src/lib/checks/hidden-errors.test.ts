import { describe, expect, it } from "vitest";
import { checkHiddenErrors } from "@/lib/checks/hidden-errors";
import type { RepoFile } from "@/lib/checks/types";

const file = (path: string, content: string): RepoFile => ({ path, content });
const rules = (files: RepoFile[]) => checkHiddenErrors(files).map((f) => `${f.ruleId}:${f.severity}`);

describe("swallowed errors", () => {
  it("flags an empty catch and ranks it higher in payment code", () => {
    const stripe = file("src/app/api/stripe/webhook/route.ts", "export async function POST() {\n  try { await save(); } catch (e) {}\n}\n");
    const other = file("src/lib/format.ts", "export function f() {\n  try { g(); } catch {}\n}\n");
    expect(rules([stripe])).toEqual(["habits.swallowed-error:MEDIUM"]);
    expect(rules([other])).toEqual(["habits.swallowed-error:LOW"]);
  });

  it("treats a database write as critical wherever it lives", () => {
    const f = file("src/lib/sync.ts", "export async function sync() {\n  try {\n    await db.insert(orders).values(row);\n  } catch {}\n}\n");
    expect(rules([f])).toEqual(["habits.swallowed-error:MEDIUM"]);
  });

  it("accepts a catch that says why it is safe, and rejects bare dismissals", () => {
    const reasoned = file("src/lib/a.ts", 'try { JSON.parse(x); } catch { /* not JSON, treated as plain text */ }\ntry { f(); } catch { // unreadable file, skip\n}\n');
    const dismissed = file("src/lib/b.ts", "try { f(); } catch { /* ignore */ }\ntry { g(); } catch { // ok\n}\n");
    expect(rules([reasoned])).toEqual([]);
    const [finding] = checkHiddenErrors([dismissed]);
    expect(finding.title).toContain("2 errors are swallowed");
  });

  it("flags a fire-and-forget .catch(() => {}) but not a parse fallback", () => {
    const f = file("src/lib/c.ts", "void notify().catch(() => {});\nconst body = await res.json().catch(() => null);\nconst x = await y().catch(() => ({}));\n");
    const [finding] = checkHiddenErrors([f]);
    expect(finding.ruleId).toBe("habits.swallowed-error");
    expect(finding.title).toContain("1 error is swallowed");
  });

  it("accepts the ordinary safe fallbacks: parsing text and browser storage", () => {
    const parse = file("src/app/api/vapi/webhook/route.ts", "let args = {};\ntry { args = JSON.parse(raw) as Args; } catch { /* noop */ }\n");
    const storage = file("src/app/page.tsx", "try {\n  const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');\n  setDraft(saved.draft);\n  setStep(saved.step);\n} catch {}\n");
    expect(rules([parse, storage])).toEqual([]);
    // A try block that does real work is still flagged, even when it also parses.
    const work = file("src/lib/a.ts", "try {\n  const v = JSON.parse(raw);\n  await db.insert(rows).values(v);\n} catch {}\n");
    expect(rules([work])).toEqual(["habits.swallowed-error:MEDIUM"]);
  });

  it("accepts a .catch(() => {}) with a reason written beside it, and still flags a bare one", () => {
    const reasoned = file("src/lib/a.ts", "// Increment the counter: best effort, a missed count is fine\nsql`UPDATE c SET n = n + 1`.catch(() => {});\n");
    const bare = file("src/lib/b.ts", "sendEmail({ to }).catch(() => {});\n");
    expect(rules([reasoned])).toEqual([]);
    expect(rules([bare])).toEqual(["habits.swallowed-error:MEDIUM"]);
  });

  it("treats analytics as best effort", () => {
    const f = file("src/app/api/checkout/route.ts", "trackFunnelStep(redis, 'checkout_initiated').catch(() => {});\n");
    expect(rules([f])).toEqual([]);
  });

  it("does not read example code inside strings or comments", () => {
    const f = file("src/lib/check.ts", 'const msg = "use try { x() } catch (e) {} carefully";\n// try { y() } catch {}\nexport const note = `.catch(() => {})`;\n');
    expect(rules([f])).toEqual([]);
  });

  it("skips tests, scripts and demo data", () => {
    const body = "try { f(); } catch {}\n";
    expect(rules([file("src/a.test.ts", body), file("scripts/seed.ts", body), file("src/demo/data.ts", body)])).toEqual([]);
  });
});

describe("failures that report success", () => {
  it("flags a catch that answers ok without saying anything", () => {
    const f = file("src/app/api/sync/route.ts", "export async function POST() {\n  try { await run(); } catch (e) {\n    return Response.json({ success: true });\n  }\n}\n");
    expect(rules([f])).toContain("habits.fake-success:MEDIUM");
  });

  it("leaves it alone when the error is logged, rethrown or deliberately answered", () => {
    const logged = file("src/a.ts", "try { f(); } catch (e) { console.error(e); return { ok: true }; }\n");
    const rethrown = file("src/b.ts", "try { f(); } catch (e) { if (x) return { ok: true }; throw e; }\n");
    const explained = file("src/c.ts", "try { f(); } catch (e) {\n  // already processed: the sender replays events, so answer ok\n  return NextResponse.json({ ok: true });\n}\n");
    expect(rules([logged, rethrown, explained])).toEqual([]);
    const unexplained = file("src/d.ts", "try { f(); } catch (e) {\n  return NextResponse.json({ ok: true });\n}\n");
    expect(rules([unexplained])).toEqual(["habits.fake-success:MEDIUM"]);
  });
});

describe("unvalidated input", () => {
  const post = (extra = "") => `${extra}export async function POST(request: Request) {\n  const body = (await request.json()) as { id?: string };\n  return Response.json(body);\n}\n`;

  it("flags a route that casts the body", () => {
    expect(rules([file("src/app/api/x/route.ts", post())])).toEqual(["habits.unvalidated-input:LOW"]);
  });

  it("accepts a route that validates with a schema", () => {
    expect(rules([file("src/app/api/x/route.ts", post('import { z } from "zod";\nconst s = z.object({});\n'))])).toEqual([]);
  });

  it("ignores read-only routes", () => {
    const get = "export async function GET(request: Request) {\n  const body = (await request.json()) as { id?: string };\n  return Response.json(body);\n}\n";
    expect(rules([file("src/app/api/x/route.ts", get)])).toEqual([]);
  });
});
