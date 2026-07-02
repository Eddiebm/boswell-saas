import { Octokit } from "@octokit/rest";
import { getGithubToken } from "@/lib/github/token";

export { getGithubToken } from "@/lib/github/token";

export async function getGithubClient(userId: string) {
  const token = await getGithubToken(userId);
  if (!token) {
    throw new Error("GitHub account not connected");
  }
  return new Octokit({ auth: token });
}

export async function listGithubRepos(userId: string) {
  const octokit = await getGithubClient(userId);
  const repos = await octokit.paginate(octokit.rest.repos.listForAuthenticatedUser, {
    per_page: 100,
    sort: "updated",
  });

  return repos.map((repo) => ({
    githubId: repo.id,
    owner: repo.owner?.login ?? "",
    name: repo.name,
    fullName: repo.full_name,
    cloneUrl: repo.clone_url,
    defaultBranch: repo.default_branch ?? "main",
    isPrivate: repo.private,
    description: repo.description,
    updatedAt: repo.updated_at,
  }));
}
