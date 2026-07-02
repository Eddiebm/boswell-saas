"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type RepoOption = {
  id: string;
  fullName: string;
};

export function PrimaryRepoSelector({
  repos,
  primaryRepoId,
}: {
  repos: RepoOption[];
  primaryRepoId: string | null;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  if (repos.length === 0) return null;

  async function onChange(repositoryId: string) {
    if (repositoryId === primaryRepoId) return;
    setLoading(true);
    try {
      const res = await fetch("/api/repos/primary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repositoryId }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to update default repo");
      }
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
        Dashboard repo
      </span>
      <select
        value={primaryRepoId ?? repos[0]?.id ?? ""}
        disabled={loading || repos.length === 0}
        onChange={(e) => void onChange(e.target.value)}
        className="max-w-[220px] rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-white"
      >
        {repos.map((repo) => (
          <option key={repo.id} value={repo.id}>
            {repo.fullName}
          </option>
        ))}
      </select>
    </label>
  );
}
