import { getGithubClient } from "@/lib/github";

export type CreatePrInput = {
  userId: string;
  owner: string;
  repo: string;
  defaultBranch: string;
  title: string;
  body: string;
  suggestedFix: string;
  files: string[];
  fixQueueItemId: string;
  rollbackNote: string;
};

export type CreatePrResult = {
  branch: string;
  prUrl: string;
  prNumber: number;
  proposalPath: string;
};

export async function createSafeFixPullRequest(input: CreatePrInput): Promise<CreatePrResult> {
  const octokit = await getGithubClient(input.userId);
  const branch = `boswell/safe-fix-${input.fixQueueItemId.replace(/-/g, "").slice(0, 12)}`;
  const proposalPath = `.boswell/proposals/${input.fixQueueItemId}.md`;

  const { data: baseRef } = await octokit.rest.git.getRef({
    owner: input.owner,
    repo: input.repo,
    ref: `heads/${input.defaultBranch}`,
  });

  await octokit.rest.git.createRef({
    owner: input.owner,
    repo: input.repo,
    ref: `refs/heads/${branch}`,
    sha: baseRef.object.sha,
  });

  const proposalMarkdown = [
    `# Boswell safe-fix proposal`,
    ``,
    `**Finding:** ${input.title}`,
    ``,
    `## Suggested fix`,
    input.suggestedFix,
    ``,
    `## Files`,
    ...(input.files.length ? input.files.map((f) => `- \`${f}\``) : ["- (see audit report)"]),
    ``,
    `## Rollback`,
    input.rollbackNote,
    ``,
    `> Boswell never pushes to main. Review and apply code changes manually if needed.`,
  ].join("\n");

  await octokit.rest.repos.createOrUpdateFileContents({
    owner: input.owner,
    repo: input.repo,
    path: proposalPath,
    message: `docs(boswell): safe-fix proposal for ${input.title}`,
    content: Buffer.from(proposalMarkdown, "utf8").toString("base64"),
    branch,
  });

  const prBody = [
    input.body,
    ``,
    `## Rollback note`,
    input.rollbackNote,
    ``,
    `Proposal file: \`${proposalPath}\``,
    ``,
    `---`,
    `*Opened by [Boswell](https://boswell-saas.vercel.app) — safe automation (green tier). Never auto-merged.*`,
  ].join("\n");

  const { data: pr } = await octokit.rest.pulls.create({
    owner: input.owner,
    repo: input.repo,
    title: `[Boswell] ${input.title}`,
    head: branch,
    base: input.defaultBranch,
    body: prBody,
  });

  return {
    branch,
    prUrl: pr.html_url,
    prNumber: pr.number,
    proposalPath,
  };
}
