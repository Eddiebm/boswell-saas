"use client";

import { useState } from "react";
import { Button } from "@/components/ui";

export function GuardToggle({ repositoryId, enabled }: { repositoryId: string; enabled: boolean }) {
  const [on, setOn] = useState(enabled);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/guard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repositoryId, enabled: !on }),
      });
      const data = (await res.json()) as { enabled?: boolean; message?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Couldn't change the guard");
      setOn(Boolean(data.enabled));
      setMessage(data.message ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button onClick={toggle} disabled={loading} variant={on ? "secondary" : undefined}>
        {loading ? "Working…" : on ? "Turn guard off" : "Turn on push guard"}
      </Button>
      {message ? <p className="text-sm text-emerald-300">{message}</p> : null}
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
    </div>
  );
}
