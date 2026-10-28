import * as Sentry from "@sentry/nextjs";

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
    // Boswell handles customer source code and GitHub identities: send the error and stack, nothing about the request.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      stackFrameVariables: false,
      genAI: { inputs: false, outputs: false },
    },
  });
}

export const onRequestError = Sentry.captureRequestError;
