import { describe, expect, it } from "vitest";
import { sendAuditAlert } from "@/lib/alerts/audit-alerts";

describe("sendAuditAlert", () => {
  it("skips when alert env is not configured", async () => {
    const prevEmail = process.env.ADMIN_ALERT_EMAIL;
    const prevKey = process.env.RESEND_API_KEY;
    delete process.env.ADMIN_ALERT_EMAIL;
    delete process.env.RESEND_API_KEY;

    const result = await sendAuditAlert({
      auditId: "test-audit",
      repoFullName: "org/repo",
      reason: "Worker timeout",
      status: "failed",
    });

    expect(result).toEqual({ sent: false, reason: "alerts_not_configured" });

    process.env.ADMIN_ALERT_EMAIL = prevEmail;
    process.env.RESEND_API_KEY = prevKey;
  });
});
