const GITHUB_API = "https://api.github.com";

export async function triggerAuditWorkerDispatch(): Promise<{ ok: boolean; reason?: string }> {
  const token =
    process.env.GITHUB_WORKFLOW_TOKEN ??
    process.env.GITHUB_BOOTSTRAP_TOKEN ??
    process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_WORKER_REPO ?? "Eddiebm/boswell-saas";

  if (!token) {
    return { ok: false, reason: "no_github_token" };
  }

  const response = await fetch(
    `${GITHUB_API}/repos/${repo}/actions/workflows/audit-worker.yml/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: "main" }),
    },
  );

  if (response.status === 204) {
    return { ok: true };
  }

  const body = await response.text();
  return { ok: false, reason: `github_${response.status}:${body.slice(0, 200)}` };
}
