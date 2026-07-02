"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active =
    pathname === href || (href !== "/dashboard" && pathname.startsWith(href));

  return (
    <Link
      href={href}
      className={cn(
        "text-sm transition",
        active ? "font-medium text-white" : "text-zinc-400 hover:text-white",
      )}
    >
      {label}
    </Link>
  );
}
