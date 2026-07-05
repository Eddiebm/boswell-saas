type AuditAlertInput = {
  auditId: string;
  repoFullName?: string;
  reason: string;
  status: "failed" | "stale_queued" | "max_retries";
};

export async function sendAuditAlert(input: AuditAlertInput) {
  const to = process.env.ADMIN_ALERT_EMAIL;
  const apiKey = process.env.RESEND_API_KEY;
  if (!to || !apiKey) return { sent: false, reason: "alerts_not_configured" };

  const from = process.env.ALERT_FROM_EMAIL ?? "Boswell <onboarding@resend.dev>";
  const appUrl = process.env.AUTH_URL ?? "https://boswell-saas.vercel.app";
  const subject = `[Boswell] Audit ${input.status}: ${input.repoFullName ?? input.auditId}`;

  const text = [
    `Audit alert: ${input.status}`,
    "",
    `Audit ID: ${input.auditId}`,
    input.repoFullName ? `Repository: ${input.repoFullName}` : null,
    `Reason: ${input.reason}`,
    "",
    `View: ${appUrl}/dashboard/audits/${input.auditId}`,
    `System: ${appUrl}/dashboard/admin`,
    `Worker: https://github.com/Eddiebm/boswell-saas/actions/workflows/audit-worker.yml`,
  ]
    .filter(Boolean)
    .join("\n");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: [to], subject, text }),
  });

  if (!response.ok) {
    const body = await response.text();
    return { sent: false, reason: `resend_error:${response.status}:${body}` };
  }

  return { sent: true as const };
}
