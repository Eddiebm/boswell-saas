"use client";

import { Button } from "@/components/ui";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-8">
      <h2 className="text-lg font-medium text-red-200">Something went wrong</h2>
      <p className="mt-2 text-sm text-zinc-400">{error.message}</p>
      <div className="mt-4">
        <Button onClick={reset} variant="secondary">
          Try again
        </Button>
      </div>
    </div>
  );
}
