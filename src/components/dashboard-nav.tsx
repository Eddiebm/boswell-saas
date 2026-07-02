import Link from "next/link";
import { signOut } from "@/lib/auth";
import { Button } from "@/components/ui";

const links = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/repos", label: "Repositories" },
  { href: "/dashboard/audits", label: "Audits" },
  { href: "/dashboard/billing", label: "Billing" },
];

export function DashboardNav() {
  return (
    <header className="border-b border-zinc-800 bg-black/60 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-8">
          <Link href="/dashboard" className="text-lg font-semibold text-white">
            Boswell Cloud
          </Link>
          <nav className="hidden gap-4 md:flex">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm text-zinc-400 transition hover:text-white"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
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
      </div>
    </header>
  );
}
