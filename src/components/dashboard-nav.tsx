import Link from "next/link";
import { signOut } from "@/lib/auth";
import { isDemoMode } from "@/lib/demo/mode";
import { Button } from "@/components/ui";
import { NavLink } from "@/components/nav-link";
import { PrimaryRepoSelector } from "@/components/primary-repo-selector";
import { NavMoreMenu } from "@/components/nav-more-menu";

const primaryLinks = [
  { href: "/dashboard", label: "Home" },
  { href: "/dashboard/repos", label: "Repositories" },
  { href: "/dashboard/audits", label: "Audits" },
];

const moreLinks = [
  { href: "/dashboard/executive", label: "Executive summary" },
  { href: "/dashboard/fix-queue", label: "Fix queue" },
  { href: "/dashboard/memory", label: "Engineering memory" },
  { href: "/dashboard/brain", label: "Engineering brain" },
  { href: "/dashboard/billing", label: "Billing" },
  { href: "/dashboard/settings", label: "Settings" },
  { href: "/dashboard/admin", label: "System status" },
];

export function DashboardNav({
  repos,
  primaryRepoId,
}: {
  repos: Array<{ id: string; fullName: string }>;
  primaryRepoId: string | null;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-zinc-800 bg-black/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-8">
          <Link href="/dashboard" className="text-lg font-semibold text-white">
            Boswell
          </Link>
          <nav className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {primaryLinks.map((link) => (
              <NavLink key={link.href} href={link.href} label={link.label} />
            ))}
            <NavMoreMenu links={moreLinks} />
          </nav>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <PrimaryRepoSelector repos={repos} primaryRepoId={primaryRepoId} />
          {isDemoMode() ? (
            <span className="rounded-full bg-amber-500/10 px-2 py-1 text-xs text-amber-300">
              Demo mode
            </span>
          ) : null}
          {!isDemoMode() ? (
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/" });
              }}
            >
              <Button type="submit" variant="ghost">
                Sign out
              </Button>
            </form>
          ) : (
            <Button href="/" variant="ghost">
              Home
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
