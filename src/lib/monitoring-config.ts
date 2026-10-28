/**
 * What every Sentry client may send. Boswell handles customer source code and
 * GitHub identities, so reports carry the error and its stack trace only —
 * nothing about the request, the user, or variables in scope.
 *
 * No imports: this file is shared by the browser, edge, server and worker
 * clients.
 */
export const SENTRY_DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  databaseQueryData: false,
  stackFrameVariables: false,
  genAI: { inputs: false, outputs: false },
};
