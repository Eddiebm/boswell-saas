import * as Sentry from "@sentry/nextjs";
import { SENTRY_DATA_COLLECTION } from "@/lib/monitoring-config";

/**
 * Server and edge error reporting. Does nothing until SENTRY_DSN is set, so
 * local development and demo mode never send events.
 */
export function register() {
  if (!process.env.SENTRY_DSN) return;
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    tracesSampleRate: 0.1,
    dataCollection: SENTRY_DATA_COLLECTION,
  });
}

export const onRequestError = Sentry.captureRequestError;
