"use client";

import { useState } from "react";
import { Button, Input } from "@/components/ui";

export function LiveUrlForm({ repositoryId, liveUrl }: { repositoryId: string; liveUrl: string | null }) {
  const [value, setValue] = useState(liveUrl ?? "");
  const [saved, setSaved] = useState(liveUrl);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(url: string | null) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/repos/live-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repositoryId, url }),
      });
      const data = (await res.json()) as { liveUrl?: string | null; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Couldn't save the URL");
      setSaved(data.liveUrl ?? null);
      setValue(data.liveUrl ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save(value.trim() || null);
      }}
    >
      <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="https://yourapp.com" className="min-w-0 flex-1 sm:max-w-sm" aria-label="Live URL" />
      <Button type="submit" disabled={loading || value.trim() === (saved ?? "")}>
        {loading ? "Saving…" : "Save"}
      </Button>
      {saved ? (
        <Button type="button" variant="ghost" disabled={loading} onClick={() => void save(null)}>
          Remove
        </Button>
      ) : null}
      {error ? <p className="w-full text-sm text-red-400">{error}</p> : null}
      {saved && !error ? <p className="w-full text-xs text-zinc-500">Checked on the next audit.</p> : null}
    </form>
  );
}
