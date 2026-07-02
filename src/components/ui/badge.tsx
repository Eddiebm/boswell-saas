import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium", {
  variants: {
    variant: {
      default: "bg-zinc-800 text-zinc-300",
      good: "bg-emerald-500/10 text-emerald-300",
      warn: "bg-amber-500/10 text-amber-300",
      bad: "bg-red-500/10 text-red-300",
      evil: "bg-purple-500/15 text-purple-200 ring-1 ring-purple-500/30",
    },
  },
  defaultVariants: { variant: "default" },
});

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export function ClassificationBadge({ classification }: { classification: string }) {
  const variant =
    classification === "good"
      ? "good"
      : classification === "bad"
        ? "warn"
        : classification === "evil"
          ? "evil"
          : "bad";
  return <Badge variant={variant}>{classification}</Badge>;
}

export function AutoFixBadge({ level }: { level: string }) {
  const variant = level === "green" ? "good" : level === "yellow" ? "warn" : "bad";
  return <Badge variant={variant}>{level.toUpperCase()}</Badge>;
}

export { Badge, badgeVariants };
