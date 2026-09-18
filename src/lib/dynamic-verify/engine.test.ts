import { afterEach, describe, expect, it, vi } from "vitest";
import { runAccessControlCheck, type VerifyTargetConfig } from "@/lib/dynamic-verify/engine";

const config: VerifyTargetConfig = {
  stagingUrl: "https://staging.example.com",
  loginPath: "/api/login",
  accountAEmail: "a@example.com",
  accountAPassword: "pw-a",
  accountBEmail: "b@example.com",
  accountBPassword: "pw-b",
  resourcePathTemplate: "/api/orders/{id}",
  accountAResourceId: "order-123",
};

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runAccessControlCheck", () => {
  it("confirms a leak when account B can read account A's resource", async () => {
    const fetchMock = vi
      .fn()
      // login A
      .mockResolvedValueOnce(jsonResponse(200, { token: "token-a" }))
      // baseline fetch as A
      .mockResolvedValueOnce(jsonResponse(200, { id: "order-123", email: "a@example.com" }))
      // login B
      .mockResolvedValueOnce(jsonResponse(200, { token: "token-b" }))
      // cross-account fetch as B
      .mockResolvedValueOnce(jsonResponse(200, { id: "order-123", email: "a@example.com" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runAccessControlCheck(config);

    expect(result.result).toBe("leak_confirmed");
    expect(result.matchedFields).toContain("account_a_email");
    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const call of fetchMock.mock.calls) {
      const init = call[1] as RequestInit | undefined;
      expect(init?.method === "GET" || init?.method === undefined ? "GET" : init?.method).not.toBe("DELETE");
      expect(init?.method).not.toBe("PUT");
      expect(init?.method).not.toBe("PATCH");
    }
  });

  it("reports no_leak when the target denies cross-account access", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { token: "token-a" }))
      .mockResolvedValueOnce(jsonResponse(200, { id: "order-123" }))
      .mockResolvedValueOnce(jsonResponse(200, { token: "token-b" }))
      .mockResolvedValueOnce(jsonResponse(403, { error: "forbidden" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runAccessControlCheck(config);

    expect(result.result).toBe("no_leak");
    expect(result.httpStatus).toBe(403);
    expect(result.matchedFields).toHaveLength(0);
  });

  it("stays inconclusive on a 2xx response with no matching evidence", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { token: "token-a" }))
      .mockResolvedValueOnce(jsonResponse(200, { id: "order-123" }))
      .mockResolvedValueOnce(jsonResponse(200, { token: "token-b" }))
      .mockResolvedValueOnce(jsonResponse(200, { message: "ok" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runAccessControlCheck(config);

    expect(result.result).toBe("inconclusive");
    expect(result.matchedFields).toHaveLength(0);
  });

  it("stays inconclusive when the baseline fetch for account A itself fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { token: "token-a" }))
      .mockResolvedValueOnce(jsonResponse(404, { error: "not found" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runAccessControlCheck(config);

    expect(result.result).toBe("inconclusive");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws when login never returns a cookie or bearer token", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(runAccessControlCheck(config)).rejects.toThrow(/Login failed/);
  });
});
