import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

/** Baseline browser protections for every route. */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

/**
 * With SENTRY_AUTH_TOKEN set (plus SENTRY_ORG and SENTRY_PROJECT), the build
 * uploads browser source maps to Sentry so errors show readable code, then
 * deletes them from the output: they're never served to visitors. Without
 * the token the build is untouched.
 */
export default process.env.SENTRY_AUTH_TOKEN
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      sourcemaps: { deleteSourcemapsAfterUpload: true },
      silent: !process.env.CI,
      telemetry: false,
    })
  : nextConfig;
