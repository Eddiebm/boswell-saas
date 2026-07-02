"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

export function SyncReposButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function syncRepos() {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/repos", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Sync failed");
      }
      setMessage(`Synced ${data.synced} repo(s). ${data.total}/${data.limit} used.`);
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button onClick={syncRepos} disabled={loading}>
        {loading ? "Syncing…" : "Sync GitHub repos"}
      </Button>
      {message ? <p className="text-sm text-zinc-400">{message}</p> : null}
    </div>
  );
}
