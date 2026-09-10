import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { isDemoMode } from "@/lib/demo/mode";
import { requireDb } from "@/lib/db";

type Result = { ok: true } | { ok: false; retryAfterSec: number };
type Bucket = { count: number; resetAt: number };
const testStore = new Map<string, Bucket>();

function memoryRateLimit(key: string, limit: number, windowMs: number): Result {
  const now = Date.now();
  const bucket = testStore.get(key);
  if (!bucket || now > bucket.resetAt) {
    testStore.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }
  if (bucket.count >= limit) {
    return { ok: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  bucket.count += 1;
  return { ok: true };
}

export async function rateLimit(key: string, limit: number, windowMs: number): Promise<Result> {
  if (process.env.NODE_ENV === "test" || isDemoMode()) {
    return memoryRateLimit(key, limit, windowMs);
  }

  const keyHash = createHash("sha256").update(key).digest("hex");
  const resetAt = new Date(Date.now() + windowMs);
  const db = requireDb();
  const result = await db.execute(sql`
    INSERT INTO rate_limit_buckets (key_hash, count, reset_at)
    VALUES (${keyHash}, 1, ${resetAt})
    ON CONFLICT (key_hash) DO UPDATE SET
      count = CASE
        WHEN rate_limit_buckets.reset_at <= NOW() THEN 1
        ELSE rate_limit_buckets.count + 1
      END,
      reset_at = CASE
        WHEN rate_limit_buckets.reset_at <= NOW() THEN ${resetAt}
        ELSE rate_limit_buckets.reset_at
      END
    RETURNING count, reset_at
  `);
  const row = result.rows[0] as { count: number | string; reset_at: Date | string } | undefined;
  if (!row) throw new Error("Rate-limit store did not return a result");
  const count = Number(row.count);
  if (count <= limit) return { ok: true };
  const retryAfterSec = Math.max(1, Math.ceil((new Date(row.reset_at).getTime() - Date.now()) / 1000));
  return { ok: false, retryAfterSec };
}

export function clientIp(request: Request): string {
  return (
    request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}
