import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Button as ShadButton } from "@/components/ui/button";
import {
  Badge as ShadBadge,
  ClassificationBadge,
  AutoFixBadge,
} from "@/components/ui/badge";
import { Card as ShadCard } from "@/components/ui/card";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  href?: string;
  variant?: "primary" | "secondary" | "ghost" | "destructive";
};

const variantMap = {
  primary: "default",
  secondary: "secondary",
  ghost: "ghost",
  destructive: "destructive",
} as const;

export function Button({ className, href, children, variant = "primary", ...props }: ButtonProps) {
  const mapped = variantMap[variant];
  if (href) {
    return (
      <ShadButton asChild variant={mapped} className={className}>
        <Link href={href}>{children}</Link>
      </ShadButton>
    );
  }
  return (
    <ShadButton variant={mapped} className={className} {...props}>
      {children}
    </ShadButton>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <ShadCard className={className}>{children}</ShadCard>;
}

export { Input } from "@/components/ui/input";
export { Skeleton } from "@/components/ui/skeleton";
export { ClassificationBadge, AutoFixBadge };

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad" | "evil";
}) {
  const variant =
    tone === "good"
      ? "good"
      : tone === "warn"
        ? "warn"
        : tone === "evil"
          ? "evil"
          : tone === "bad"
            ? "bad"
            : "default";
  return <ShadBadge variant={variant}>{children}</ShadBadge>;
}
