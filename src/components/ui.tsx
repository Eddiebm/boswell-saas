import type { ButtonHTMLAttributes, ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export function Button({
  className,
  href,
  children,
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  href?: string;
  variant?: "primary" | "secondary" | "ghost";
}) {
  const styles = cn(
    "inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition",
    variant === "primary" && "bg-white text-black hover:bg-zinc-200",
    variant === "secondary" && "border border-zinc-700 text-zinc-100 hover:bg-zinc-900",
    variant === "ghost" && "text-zinc-300 hover:text-white hover:bg-zinc-900",
    className,
  );

  if (href) {
    return (
      <Link href={href} className={styles}>
        {children}
      </Link>
    );
  }

  return (
    <button className={styles} {...props}>
      {children}
    </button>
  );
}

export function Card({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("rounded-2xl border border-zinc-800 bg-zinc-950/80 p-6", className)}>
      {children}
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2.5 py-1 text-xs font-medium",
        tone === "neutral" && "bg-zinc-800 text-zinc-300",
        tone === "good" && "bg-emerald-500/10 text-emerald-300",
        tone === "warn" && "bg-amber-500/10 text-amber-300",
        tone === "bad" && "bg-red-500/10 text-red-300",
      )}
    >
      {children}
    </span>
  );
}
