export function isDemoMode() {
  return process.env.BOSWELL_DEMO === "1" || !process.env.DATABASE_URL;
}
