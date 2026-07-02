import { DashboardNav } from "@/components/dashboard-nav";
import { getPrimaryRepoId, getRepositories } from "@/lib/data";
import { requireUserId } from "@/lib/session";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const userId = await requireUserId();
  const repos = await getRepositories(userId);
  const primaryRepoId = await getPrimaryRepoId(userId);

  return (
    <div className="min-h-screen bg-black text-white">
      <DashboardNav repos={repos} primaryRepoId={primaryRepoId} />
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
