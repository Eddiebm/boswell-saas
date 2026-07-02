import Link from "next/link";
import { signOut } from "@/lib/auth";
import { isDemoMode } from "@/lib/demo/mode";
import { Button } from "@/components/ui";
import { NavLink } from "@/components/nav-link";

const links = [
  { href: "/dashboard", label: "Daily Briefing" },
  { href: "/dashboard/onboarding", label: "Setup" },
  { href: "/dashboard/executive", label: "Executive" },
  { href: "/dashboard/repos", label: "Repositories" },
  { href: "/dashboard/audits", label: "Audits" },
  { href: "/dashboard/fix-queue", label: "Fix Queue" },
  { href: "/dashboard/memory", label: "Memory" },
  { href: "/dashboard/brain", label: "Engineering Brain" },
  { href: "/dashboard/settings", label: "Settings" },
  { href: "/dashboard/billing", label: "Billing" },
  { href: "/dashboard/admin", label: "System" },
];

export function DashboardNav() {
  return (
    <header className="border-b border-zinc-800 bg-black/60 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:gap-8">
          <Link href="/dashboard" className="text-lg font-semibold text-white">
            Boswell
          </Link>
          <nav className="flex flex-wrap gap-x-4 gap-y-2">
            {links.map((link) => (
              <NavLink key={link.href} href={link.href} label={link.label} />
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
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
