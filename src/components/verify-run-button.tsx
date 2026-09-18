"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

export function VerifyRunButton({ targetId }: { targetId: string }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setSubmitting(true);
    setError(null);
    const res = await fetch("/api/verify/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetId }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      setError(data.error ?? "Failed to queue run");
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="secondary" onClick={run} disabled={submitting}>
        {submitting ? "Queuing…" : "Run now"}
      </Button>
      {error ? <span className="text-sm text-red-400">{error}</span> : null}
    </div>
  );
}
