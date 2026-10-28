import { afterEach, describe, expect, it } from "vitest";
import { isAdminEmail } from "@/lib/admin";

describe("isAdminEmail", () => {
  const prevAdminEmail = process.env.ADMIN_ALERT_EMAIL;

  afterEach(() => {
    if (prevAdminEmail === undefined) {
      delete process.env.ADMIN_ALERT_EMAIL;
    } else {
      process.env.ADMIN_ALERT_EMAIL = prevAdminEmail;
    }
  });

  it("matches the configured admin email case-insensitively", () => {
    process.env.ADMIN_ALERT_EMAIL = "owner@example.com";
    expect(isAdminEmail("owner@example.com")).toBe(true);
    expect(isAdminEmail("Owner@Example.com")).toBe(true);
    expect(isAdminEmail("  owner@example.com  ")).toBe(true);
  });

  it("rejects any other signed-in user", () => {
    process.env.ADMIN_ALERT_EMAIL = "owner@example.com";
    expect(isAdminEmail("random-user@example.com")).toBe(false);
    expect(isAdminEmail(null)).toBe(false);
    expect(isAdminEmail(undefined)).toBe(false);
  });

  it("fails closed when ADMIN_ALERT_EMAIL is not configured", () => {
    delete process.env.ADMIN_ALERT_EMAIL;
    expect(isAdminEmail("owner@example.com")).toBe(false);
    expect(isAdminEmail(undefined)).toBe(false);
  });
});
