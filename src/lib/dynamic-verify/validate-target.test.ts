import { afterEach, describe, expect, it, vi } from "vitest";
import { assertRelativePath, assertSafeStagingUrl } from "@/lib/dynamic-verify/validate-target";

vi.mock("node:dns/promises", () => ({
  default: {
    lookup: vi.fn(async (hostname: string) => {
      if (hostname === "staging.example.com") return [{ address: "203.0.113.10", family: 4 }];
      if (hostname === "internal.corp") return [{ address: "10.0.5.1", family: 4 }];
      if (hostname === "rebinds-to-metadata.evil") return [{ address: "169.254.169.254", family: 4 }];
      throw new Error("NXDOMAIN");
    }),
  },
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("assertSafeStagingUrl", () => {
  it("accepts a public https host", async () => {
    await expect(assertSafeStagingUrl("https://staging.example.com")).resolves.toBeUndefined();
  });

  it.each(["http://127.0.0.1:3000", "http://localhost:3000", "http://169.254.169.254/latest/meta-data"])(
    "rejects a literal private/loopback/cloud-metadata IP: %s",
    async (url) => {
      await expect(assertSafeStagingUrl(url)).rejects.toThrow();
    },
  );

  it("rejects a hostname that resolves to an RFC1918 address", async () => {
    await expect(assertSafeStagingUrl("https://internal.corp")).rejects.toThrow(/private or reserved/);
  });

  it("rejects a hostname that resolves to the cloud metadata address", async () => {
    await expect(assertSafeStagingUrl("https://rebinds-to-metadata.evil")).rejects.toThrow(/private or reserved/);
  });

  it("rejects non-http(s) protocols", async () => {
    await expect(assertSafeStagingUrl("file:///etc/passwd")).rejects.toThrow(/http or https/);
    await expect(assertSafeStagingUrl("ftp://example.com")).rejects.toThrow(/http or https/);
  });

  it("rejects embedded credentials", async () => {
    await expect(assertSafeStagingUrl("https://user:pass@staging.example.com")).rejects.toThrow(/credentials/);
  });

  it("rejects an unresolvable host", async () => {
    await expect(assertSafeStagingUrl("https://no-such-host.invalid")).rejects.toThrow();
  });

  it("rejects a malformed URL", async () => {
    await expect(assertSafeStagingUrl("not a url")).rejects.toThrow(/not a valid URL/);
  });
});

describe("assertRelativePath", () => {
  it("accepts a plain relative path", () => {
    expect(() => assertRelativePath("/api/orders/{id}", "resourcePathTemplate")).not.toThrow();
  });

  it("rejects an absolute URL used as a path", () => {
    expect(() => assertRelativePath("https://evil.com/steal", "resourcePathTemplate")).toThrow();
  });

  it("rejects a path that starts with / but embeds a scheme", () => {
    expect(() => assertRelativePath("/https://evil.com/steal", "resourcePathTemplate")).toThrow(/absolute URL/);
  });

  it("rejects a protocol-relative URL", () => {
    expect(() => assertRelativePath("//evil.com/steal", "loginPath")).toThrow();
  });

  it("rejects a path that doesn't start with /", () => {
    expect(() => assertRelativePath("api/login", "loginPath")).toThrow();
  });
});
