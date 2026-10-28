import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { askOpenRouter, buildEvidenceContext } from "@/lib/brain/openrouter";

describe("buildEvidenceContext", () => {
  it("lists every piece of evidence on its own line", () => {
    const context = buildEvidenceContext({
      repoName: "acme/app",
      score: 812,
      slopPercent: 7,
      briefingSummary: "Two high findings.",
      topFindings: ["Open redirect (src/app/login.ts)", "No rate limit"],
      memoryEvents: ["Audit completed"],
      fixQueue: ["Add rate limit"],
      riskyFiles: ["src/middleware.ts", "src/lib/auth.ts"],
    });
    expect(context.split("\n")).toEqual([
      "Repository: acme/app",
      "Health score: 812/1000",
      "AI Slop: 7% (indicators only)",
      "Briefing: Two high findings.",
      "Top findings: Open redirect (src/app/login.ts); No rate limit",
      "Fix queue: Add rate limit",
      "Memory: Audit completed",
      "Risky files: src/middleware.ts, src/lib/auth.ts",
    ]);
  });

  it("says so when a list is empty instead of leaving it blank", () => {
    const context = buildEvidenceContext({
      repoName: "acme/app",
      score: 0,
      slopPercent: 0,
      briefingSummary: "",
      topFindings: [],
      memoryEvents: [],
      fixQueue: [],
      riskyFiles: [],
    });
    expect(context).toContain("Top findings: none");
    expect(context).toContain("Fix queue: empty");
    expect(context).toContain("Memory: none");
    expect(context).toContain("Risky files: none");
  });
});

describe("askOpenRouter", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubEnv("OPENROUTER_MODEL", "test/model");
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("returns null without calling out when no key is configured", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    expect(await askOpenRouter("q", "ctx")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the evidence and question, and returns the trimmed answer", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "  Auth lives in middleware.  " } }], model: "served/model" })),
    );
    const result = await askOpenRouter("Where is auth?", "Repository: acme/app");
    expect(result).toEqual({ answer: "Auth lives in middleware.", model: "served/model" });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer test-key");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("test/model");
    expect(body.messages[1].content).toContain("Repository: acme/app");
    expect(body.messages[1].content).toContain("Where is auth?");
  });

  it("falls back to the requested model name when the response omits it", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] })));
    expect(await askOpenRouter("q", "ctx")).toEqual({ answer: "ok", model: "test/model" });
  });

  it("returns null on an error status, an empty answer or a network failure", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 502 }));
    expect(await askOpenRouter("q", "ctx")).toBeNull();

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "   " } }] })));
    expect(await askOpenRouter("q", "ctx")).toBeNull();

    fetchMock.mockRejectedValueOnce(new Error("timeout"));
    expect(await askOpenRouter("q", "ctx")).toBeNull();
  });
});
