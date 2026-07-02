"use client";

import { useState } from "react";
import { Button } from "@/components/ui";

export function SafeFixPrButton({ itemId }: { itemId: string }) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [prUrl, setPrUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function createPr() {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/pr/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        message?: string;
        prUrl?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Failed to create PR");
      setMessage(data.message ?? "PR opened");
      if (data.prUrl) setPrUrl(data.prUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button onClick={createPr} disabled={loading} variant="secondary">
        {loading ? "Opening PR…" : "Create safe-fix PR"}
      </Button>
      {message ? <p className="text-sm text-emerald-300">{message}</p> : null}
      {prUrl ? (
        <a href={prUrl} target="_blank" rel="noreferrer" className="text-sm underline">
          View pull request
        </a>
      ) : null}
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
    </div>
  );
}
