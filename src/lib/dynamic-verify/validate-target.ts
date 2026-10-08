import dns from "node:dns/promises";
import net from "node:net";

/**
 * SSRF guards for the live access-control verification module. A target's
 * stagingUrl, loginPath and resourcePathTemplate are all attacker-controlled
 * (any Pro user can set them), and the worker makes real outbound requests
 * to whatever they resolve to — so every one of them needs validating
 * before a target can be saved or run, not just trusted from the consent
 * checkbox.
 */

function isPrivateOrReservedIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts;
  if (a === 0) return true; // "this network"
  if (a === 10) return true; // RFC1918
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, incl. 169.254.169.254 cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT (RFC6598)
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isPrivateOrReservedIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true; // loopback / unspecified
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return true; // link-local fe80::/10
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true; // unique local fc00::/7
  const v4Mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Mapped) return isPrivateOrReservedIpv4(v4Mapped[1]);
  return false;
}

function isBlockedAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return isPrivateOrReservedIpv4(address);
  if (family === 6) return isPrivateOrReservedIpv6(address);
  return true; // not a recognizable IP — fail closed
}

/**
 * Rejects anything but a plain http(s) URL whose host (and every address it
 * resolves to) is public — no loopback, RFC1918, link-local/cloud-metadata,
 * CGNAT, or embedded credentials.
 */
export async function assertSafeStagingUrl(rawUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("stagingUrl is not a valid URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("stagingUrl must be http or https");
  }
  if (url.username || url.password) {
    throw new Error("stagingUrl must not include embedded credentials");
  }

  const hostname = url.hostname;
  if (hostname === "localhost") {
    throw new Error("stagingUrl resolves to a disallowed host");
  }

  if (net.isIP(hostname)) {
    if (isBlockedAddress(hostname)) {
      throw new Error("stagingUrl resolves to a private or reserved address");
    }
    return;
  }

  let records: Array<{ address: string }>;
  try {
    records = await dns.lookup(hostname, { all: true });
  } catch {
    throw new Error("stagingUrl host could not be resolved");
  }
  if (records.length === 0 || records.some((r) => isBlockedAddress(r.address))) {
    throw new Error("stagingUrl resolves to a private or reserved address");
  }
}

/**
 * loginPath / resourcePathTemplate must be a plain path on the staging
 * origin — never an absolute or protocol-relative URL, which `new URL(path,
 * base)` would otherwise happily resolve to a completely different host.
 */
export function assertRelativePath(path: string, label: string): void {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error(`${label} must be a relative path starting with a single "/"`);
  }
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(path)) {
    throw new Error(`${label} must not be an absolute URL`);
  }
}
