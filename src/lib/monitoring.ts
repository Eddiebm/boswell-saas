import * as Sentry from "@sentry/node";
import { SENTRY_DATA_COLLECTION } from "@/lib/monitoring-config";

export type WorkerComponent = "audit" | "guard" | "verify" | "repo-checks" | "live-checks" | "worker";

/**
 * Error reporting for the audit worker, which runs on GitHub Actions (or the
 * worker container), not on Vercel, so the app's instrumentation never sees
 * its failures. Does nothing until SENTRY_DSN is set.
 */
export function initWorkerMonitoring() {
  if (!process.env.SENTRY_DSN || Sentry.getClient()) return;
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: `worker-${process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "production"}`,
    dataCollection: SENTRY_DATA_COLLECTION,
  });
}

/**
 * Reports a caught error. Works in the worker and inside the Next.js server
 * (where @sentry/nextjs set up the client); without a client it's a no-op.
 * Only internal run ids are attached — never repository names or content.
 */
export function reportError(error: unknown, context: { component: WorkerComponent; runId?: string }) {
  Sentry.captureException(error, { tags: { component: context.component, ...(context.runId ? { runId: context.runId } : {}) } });
}

/** Sends queued reports before the process exits. */
export async function flushMonitoring() {
  if (Sentry.getClient()) await Sentry.flush(2000);
}
